import { Context } from 'hono';
import { Response } from 'hono';
import { Options, Params } from '../../types/requestBody';
import { endpointStrings } from '../../providers/types';
import { RequestContext } from './requestContext';
import { HooksService } from './hooksService';
import { ProviderContext } from './providerContext';
import { LogsService, LogObjectBuilder } from './logsService';
import { ResponseService } from './responseService';
import { CacheService, CacheResponseObject } from './cacheService';
import { PreRequestValidatorService } from './preRequestValidatorService';
import { HookSpan } from '../../middlewares/hooks';
import { 
  ServiceContainer, 
  HookProcessingResult, 
  CacheProcessingResult, 
  ValidationProcessingResult,
  RequestProcessingResult 
} from '../types';
import { RequestErrorHandler } from './errorHandler';

export class RequestProcessor {
  private services: ServiceContainer;
  private requestContext: RequestContext;
  private logObject: LogObjectBuilder;
  private hookSpan: HookSpan;

  constructor(
    private c: Context,
    private providerOption: Options,
    private requestBody: Params | FormData | ArrayBuffer | ReadableStream,
    private requestHeaders: Record<string, string>,
    private fn: endpointStrings,
    private currentIndex: number | string,
    private method: string = 'POST'
  ) {
    this.requestContext = new RequestContext(
      c,
      providerOption,
      fn,
      requestHeaders,
      requestBody,
      method,
      currentIndex as number
    );
    this.services = this.initializeServices();
    this.hookSpan = this.services.hooksService.hookSpan;
    this.logObject = new LogObjectBuilder(this.services.logsService, this.requestContext);
  }

  /**
   * Main processing method that orchestrates the entire request flow
   */
  async process(): Promise<Response> {
    try {
      await this.setupRequestContext();
      
      const beforeHookResult = await this.handleBeforeRequestHooks();
      if (beforeHookResult.response) {
        return this.createEarlyResponse(beforeHookResult);
      }

      this.updateRequestContextFromHooks(beforeHookResult);
      await this.prepareRequest();
      
      const fetchOptions = await this.buildFetchOptions();

      const cacheResult = await this.handleCaching(fetchOptions);
      if (cacheResult.response) {
        return this.createCachedResponse(cacheResult, fetchOptions);
      }

      const validationResult = await this.handlePreRequestValidation(fetchOptions, cacheResult);
      if (validationResult.response) {
        return this.createValidationResponse(validationResult, fetchOptions, cacheResult);
      }

      return this.executeMainRequest(fetchOptions, cacheResult);

    } catch (error: any) {
      return RequestErrorHandler.handleTryPostError(error);
    }
  }

  /**
   * Initializes all required services
   */
  private initializeServices(): ServiceContainer {
    const hooksService = new HooksService(this.requestContext);
    
    return {
      hooksService,
      providerContext: new ProviderContext(this.requestContext.provider),
      logsService: new LogsService(this.c),
      responseService: new ResponseService(this.requestContext, hooksService),
      cacheService: new CacheService(this.c, hooksService),
      preRequestValidator: new PreRequestValidatorService(this.c, this.requestContext),
    };
  }

  /**
   * Sets up the initial request context
   */
  private async setupRequestContext(): Promise<void> {
    this.requestContext.requestURL = await this.services.providerContext.getFullURL(this.requestContext);
    this.logObject.addHookSpanId(this.hookSpan.id);
  }

  /**
   * Handles before request hooks
   */
  private async handleBeforeRequestHooks(): Promise<HookProcessingResult> {
    const { beforeRequestHookHandler } = await import('../handlerUtils');
    
    const {
      response: brhResponse,
      createdAt: brhCreatedAt,
      transformedBody,
    } = await beforeRequestHookHandler(this.c, this.hookSpan.id);

    return {
      response: brhResponse,
      createdAt: brhCreatedAt,
      transformedBody,
    };
  }

  /**
   * Creates early response for before request hook failures
   */
  private async createEarlyResponse(hookResult: HookProcessingResult): Promise<Response> {
    // Ensure transformed request body is set for logging
    if (!this.services.providerContext.hasRequestHandler(this.requestContext)) {
      this.requestContext.transformToProviderRequestAndSave();
    }

    const { response, originalResponseJson } = await this.services.responseService.create({
      response: hookResult.response!,
      responseTransformer: undefined,
      isResponseAlreadyMapped: false,
      cache: {
        isCacheHit: false,
        cacheStatus: undefined,
        cacheKey: undefined,
      },
      retryAttempt: 0,
      createdAt: hookResult.createdAt!,
    });

    this.logObject
      .updateRequestContext(this.requestContext)
      .addResponse(response, originalResponseJson)
      .addCache()
      .log();

    return response;
  }

  /**
   * Updates request context based on hook transformations
   */
  private updateRequestContextFromHooks(hookResult: HookProcessingResult): void {
    if (hookResult.transformedBody) {
      this.requestContext.params = this.hookSpan.getContext().request.json;
    }
  }

  /**
   * Prepares the request by transforming it to provider format
   */
  private async prepareRequest(): Promise<void> {
    if (!this.services.providerContext.hasRequestHandler(this.requestContext)) {
      this.requestContext.transformToProviderRequestAndSave();
    }
  }

  /**
   * Builds fetch options for the request
   */
  private async buildFetchOptions(): Promise<RequestInit> {
    const { constructRequest } = await import('../handlerUtils');
    return constructRequest(this.services.providerContext, this.requestContext);
  }

  /**
   * Handles caching logic
   */
  private async handleCaching(fetchOptions: RequestInit): Promise<CacheProcessingResult> {
    const cacheResponseObject: CacheResponseObject = await this.services.cacheService.getCachedResponse(
      this.requestContext,
      fetchOptions.headers || {}
    );

    this.logObject.addCache(cacheResponseObject.cacheStatus, cacheResponseObject.cacheKey);

    return {
      response: cacheResponseObject.cacheResponse,
      cacheStatus: cacheResponseObject.cacheStatus,
      cacheKey: cacheResponseObject.cacheKey,
      createdAt: cacheResponseObject.createdAt,
    };
  }

  /**
   * Creates response for cache hits
   */
  private async createCachedResponse(
    cacheResult: CacheProcessingResult,
    fetchOptions: RequestInit
  ): Promise<Response> {
    const { response, originalResponseJson } = await this.services.responseService.create({
      response: cacheResult.response!,
      responseTransformer: this.requestContext.endpoint,
      cache: {
        isCacheHit: true,
        cacheStatus: cacheResult.cacheStatus,
        cacheKey: cacheResult.cacheKey,
      },
      isResponseAlreadyMapped: false,
      retryAttempt: 0,
      fetchOptions,
      createdAt: cacheResult.createdAt!,
      executionTime: 0,
    });

    this.logObject
      .updateRequestContext(this.requestContext, fetchOptions.headers)
      .addResponse(response, originalResponseJson)
      .log();

    return response;
  }

  /**
   * Handles pre-request validation (e.g., virtual key budgets)
   */
  private async handlePreRequestValidation(
    fetchOptions: RequestInit,
    cacheResult: CacheProcessingResult
  ): Promise<ValidationProcessingResult> {
    const preRequestValidatorResponse = await this.services.preRequestValidator.getResponse();
    
    return {
      response: preRequestValidatorResponse,
    };
  }

  /**
   * Creates response for validation failures
   */
  private async createValidationResponse(
    validationResult: ValidationProcessingResult,
    fetchOptions: RequestInit,
    cacheResult: CacheProcessingResult
  ): Promise<Response> {
    const { response, originalResponseJson } = await this.services.responseService.create({
      response: validationResult.response!,
      responseTransformer: undefined,
      isResponseAlreadyMapped: false,
      cache: {
        isCacheHit: false,
        cacheStatus: cacheResult.cacheStatus,
        cacheKey: cacheResult.cacheKey,
      },
      retryAttempt: 0,
      fetchOptions,
      createdAt: new Date(),
    });

    this.logObject
      .updateRequestContext(this.requestContext, fetchOptions.headers)
      .addResponse(response, originalResponseJson)
      .log();

    return response;
  }

  /**
   * Executes the main request with retries and hooks
   */
  private async executeMainRequest(
    fetchOptions: RequestInit,
    cacheResult: CacheProcessingResult
  ): Promise<Response> {
    const { recursiveAfterRequestHookHandler } = await import('../handlerUtils');
    
    const { mappedResponse, retryCount, createdAt, originalResponseJson } =
      await recursiveAfterRequestHookHandler(
        this.requestContext,
        fetchOptions,
        0,
        this.hookSpan.id,
        this.services.providerContext,
        this.services.hooksService,
        this.logObject
      );

    const { response, originalResponseJson: mappedOriginalResponseJson } =
      await this.services.responseService.create({
        response: mappedResponse,
        responseTransformer: undefined,
        isResponseAlreadyMapped: true,
        cache: {
          isCacheHit: false,
          cacheStatus: cacheResult.cacheStatus,
          cacheKey: cacheResult.cacheKey,
        },
        retryAttempt: retryCount,
        fetchOptions,
        createdAt,
        originalResponseJson,
      });

    this.logObject
      .updateRequestContext(this.requestContext, fetchOptions.headers)
      .addResponse(response, mappedOriginalResponseJson)
      .log();

    return response;
  }
}