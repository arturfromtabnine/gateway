import { Context } from 'hono';
import { HEADER_KEYS, CONTENT_TYPES } from '../globals';
import { endpointStrings } from '../providers/types';
import { Options, Params, StrategyModes, Targets } from '../types/requestBody';
import { convertKeysToCamelCase } from '../utils';
import { retryRequest } from './retryHandler';
import { env } from 'hono/adapter';
import { afterRequestHookHandler, responseHandler } from './responseHandlers';
import { HookSpan } from '../middlewares/hooks';
import { GatewayError } from '../errors/GatewayError';
import { HookType } from '../middlewares/hooks/types';

// Services
import { CacheResponseObject, CacheService } from './services/cacheService';
import { HooksService } from './services/hooksService';
import { LogObjectBuilder, LogsService } from './services/logsService';
import { PreRequestValidatorService } from './services/preRequestValidatorService';
import { ProviderContext } from './services/providerContext';
import { RequestContext } from './services/requestContext';
import { ResponseService } from './services/responseService';
import { RequestProcessor } from './services/requestProcessor';
import { ProviderConfigBuilder } from './services/providerConfigBuilder';
import { HeaderProcessor } from './services/headerProcessor';
import { RequestErrorHandler } from './services/errorHandler';
import { StrategyFactory } from './strategies';

// Constants and Types
import { REQUEST_PROCESSING, ERROR_MESSAGES, HOOK_PROPERTIES, STRATEGY_CONFIG } from './constants';
import { 
  HookShorthandInput, 
  ProcessedHookObject, 
  StrategyContext, 
  InheritedConfigData,
  CircuitBreakerConfig 
} from './types';

function constructRequestBody(
  requestContext: RequestContext,
  providerHeaders: Record<string, string>
): BodyInit | null {
  const { isMultiPartRequest, isProxyAudio, shouldProcessAsJson } = 
    HeaderProcessor.shouldProcessRequestBody(requestContext, providerHeaders);

  let body: BodyInit | null = null;
  const reqBody = requestContext.transformedRequestBody;

  if (isMultiPartRequest) {
    body = reqBody as FormData;
  } else if (requestContext.requestBody instanceof ReadableStream) {
    body = requestContext.requestBody;
  } else if (isProxyAudio) {
    body = reqBody as ArrayBuffer;
  } else if (shouldProcessAsJson) {
    body = JSON.stringify(reqBody);
  }

  if (['GET', 'DELETE'].includes(requestContext.method)) {
    body = null;
  }

  return body;
}

function constructRequestHeaders(
  requestContext: RequestContext,
  providerConfigMappedHeaders: Record<string, string>
): Record<string, string> {
  const headerProcessor = new HeaderProcessor(requestContext);
  return headerProcessor.buildFinalHeaders(providerConfigMappedHeaders, requestContext.forwardHeaders);
}

/**
 * Constructs the request options for the API call.
 *
 * @param {any} headers - The headers to add in the request.
 * @param {string} provider - The provider for the request.
 * @param {string} method - The HTTP method for the request.
 * @returns {RequestInit} - The fetch options for the request.
 */
export async function constructRequest(
  providerContext: ProviderContext,
  requestContext: RequestContext
): Promise<RequestInit> {
  const providerMappedHeaders =
    await providerContext.getHeaders(requestContext);

  const headers = constructRequestHeaders(
    requestContext,
    providerMappedHeaders
  );

  const fetchOptions: RequestInit = {
    method: requestContext.method,
    headers,
    ...(requestContext.endpoint === 'uploadFile' && { duplex: 'half' }),
  };

  const body = constructRequestBody(requestContext, providerMappedHeaders);
  if (body) {
    fetchOptions.body = body;
  }

  return fetchOptions;
}

/**
 * Selects a provider based on their assigned weights.
 * The weight is used to determine the probability of each provider being chosen.
 * If all providers have a weight of 0, an error will be thrown.
 *
 * @param {Options[]} providers - The available providers.
 * @returns {Options} - The selected provider.
 * @throws Will throw an error if no provider is selected, or if all weights are 0.
 */
export function selectProviderByWeight(providers: Options[]): Options {
  // Assign a default weight to providers with undefined weight
  const weightedProviders = providers.map((provider) => ({
    ...provider,
    weight: provider.weight ?? REQUEST_PROCESSING.DEFAULT_WEIGHT,
  }));

  // Compute the total weight
  const totalWeight = weightedProviders.reduce(
    (sum: number, provider) => sum + (provider.weight || 0),
    0
  );

  if (totalWeight === 0) {
    throw new Error(ERROR_MESSAGES.NO_PROVIDER_SELECTED);
  }

  // Select a random weight between 0 and totalWeight
  let randomWeight = Math.random() * totalWeight;

  // Find the provider that corresponds to the selected weight
  for (const [index, provider] of weightedProviders.entries()) {
    const providerWeight = provider.weight || 0;
    if (randomWeight < providerWeight) {
      return { ...provider, index };
    }
    randomWeight -= providerWeight;
  }

  throw new Error(ERROR_MESSAGES.NO_PROVIDER_SELECTED);
}

export function convertHooksShorthand(
  hooksArr: HookShorthandInput[],
  type: string,
  hookType: HookType
): ProcessedHookObject[] {
  return hooksArr.map((hook: HookShorthandInput) => {
    let hooksObject: any = {
      type: hookType,
      id: `${type}_guardrail_${Math.random().toString(36).substring(2, HOOK_PROPERTIES.EXTRACTABLE_KEYS.length)}`,
    };

    // Extract known properties from hook and add to hooksObject
    HOOK_PROPERTIES.EXTRACTABLE_KEYS.forEach((key) => {
      if (hook.hasOwnProperty(key)) {
        hooksObject[key] = hook[key];
        delete hook[key];
      }
    });

    hooksObject = convertKeysToCamelCase(hooksObject);

    // Add all remaining properties as checks
    hooksObject.checks = Object.keys(hook).map((key) => ({
      id: key.includes('.') ? key : `${HOOK_PROPERTIES.DEFAULT_PLUGIN_PREFIX}${key}`,
      parameters: hook[key],
      is_enabled: hook[key]?.is_enabled,
    }));

    return hooksObject as ProcessedHookObject;
  });
}

/**
 * Makes a POST request to a provider and returns the response.
 * The POST request is constructed using the provider, apiKey, and requestBody parameters.
 * The fn parameter is the type of request being made (e.g., "complete", "chatComplete").
 *
 * @param {Options} providerOption - The provider options. This object follows the Options interface and may contain a RetrySettings object for retry configuration.
 * @param {RequestBody} requestBody - The request body.
 * @param {string} fn - The function for the request.
 * @returns {Promise<CompletionResponse>} - The response from the POST request.
 * @throws Will throw an error if the response is not ok or if all retry attempts fail.
 */
export async function tryPost(
  c: Context,
  providerOption: Options,
  requestBody: Params | FormData | ArrayBuffer | ReadableStream,
  requestHeaders: Record<string, string>,
  fn: endpointStrings,
  currentIndex: number | string,
  method: string = 'POST'
): Promise<Response> {
  const processor = new RequestProcessor(
    c, 
    providerOption, 
    requestBody, 
    requestHeaders, 
    fn, 
    currentIndex, 
    method
  );
  
  return processor.process();
}

export async function tryTargetsRecursively(
  c: Context,
  targetGroup: Targets,
  request: Params | FormData | ReadableStream,
  requestHeaders: Record<string, string>,
  fn: endpointStrings,
  method: string,
  jsonPath: string,
  inheritedConfig: InheritedConfigData = {}
): Promise<Response> {
  const currentTarget: any = { ...targetGroup };
  let currentJsonPath = jsonPath;
  const strategyMode = currentTarget.strategy?.mode;

  // start: merge inherited config with current target config (preference given to current)
  const currentInheritedConfig: Record<string, any> = {
    id: inheritedConfig.id || currentTarget.id,
    overrideParams: {
      ...inheritedConfig.overrideParams,
      ...currentTarget.overrideParams,
    },
    retry: currentTarget.retry
      ? { ...currentTarget.retry }
      : { ...inheritedConfig.retry },
    cache: currentTarget.cache
      ? { ...currentTarget.cache }
      : { ...inheritedConfig.cache },
    requestTimeout: null,
    defaultInputGuardrails: inheritedConfig.defaultInputGuardrails,
    defaultOutputGuardrails: inheritedConfig.defaultOutputGuardrails,
  };

  // Inherited config can be empty only for the base case of recursive call.
  // To avoid redundant conversion of guardrails to hooks, we do this check.
  if (Object.keys(inheritedConfig).length === 0) {
    if (currentTarget.defaultInputGuardrails) {
      currentInheritedConfig.defaultInputGuardrails = [
        ...convertHooksShorthand(
          currentTarget.defaultInputGuardrails,
          'input',
          HookType.GUARDRAIL
        ),
      ];
    }
    if (currentTarget.defaultOutputGuardrails) {
      currentInheritedConfig.defaultOutputGuardrails = [
        ...convertHooksShorthand(
          currentTarget.defaultOutputGuardrails,
          'output',
          HookType.GUARDRAIL
        ),
      ];
    }
  }

  if (typeof currentTarget.strictOpenAiCompliance === 'boolean') {
    currentInheritedConfig.strictOpenAiCompliance =
      currentTarget.strictOpenAiCompliance;
  } else if (typeof inheritedConfig.strictOpenAiCompliance === 'boolean') {
    currentInheritedConfig.strictOpenAiCompliance =
      inheritedConfig.strictOpenAiCompliance;
  }

  if (currentTarget.forwardHeaders) {
    currentInheritedConfig.forwardHeaders = [...currentTarget.forwardHeaders];
  } else if (inheritedConfig.forwardHeaders) {
    currentInheritedConfig.forwardHeaders = [...inheritedConfig.forwardHeaders];
    currentTarget.forwardHeaders = [...inheritedConfig.forwardHeaders];
  }

  if (currentTarget.customHost) {
    currentInheritedConfig.customHost = currentTarget.customHost;
  } else if (inheritedConfig.customHost) {
    currentInheritedConfig.customHost = inheritedConfig.customHost;
    currentTarget.customHost = inheritedConfig.customHost;
  }

  if (currentTarget.requestTimeout) {
    currentInheritedConfig.requestTimeout = currentTarget.requestTimeout;
  } else if (inheritedConfig.requestTimeout) {
    currentInheritedConfig.requestTimeout = inheritedConfig.requestTimeout;
    currentTarget.requestTimeout = inheritedConfig.requestTimeout;
  }

  if (currentTarget.inputGuardrails) {
    currentTarget.beforeRequestHooks = [
      ...(currentTarget.beforeRequestHooks || []),
      ...convertHooksShorthand(
        currentTarget.inputGuardrails,
        'input',
        HookType.GUARDRAIL
      ),
    ];
  }

  if (currentTarget.outputGuardrails) {
    currentTarget.afterRequestHooks = [
      ...(currentTarget.afterRequestHooks || []),
      ...convertHooksShorthand(
        currentTarget.outputGuardrails,
        'output',
        HookType.GUARDRAIL
      ),
    ];
  }

  if (currentTarget.inputMutators) {
    currentTarget.beforeRequestHooks = [
      ...(currentTarget.beforeRequestHooks || []),
      ...convertHooksShorthand(
        currentTarget.inputMutators,
        'input',
        HookType.MUTATOR
      ),
    ];
  }

  if (currentTarget.outputMutators) {
    currentTarget.afterRequestHooks = [
      ...(currentTarget.afterRequestHooks || []),
      ...convertHooksShorthand(
        currentTarget.outputMutators,
        'output',
        HookType.MUTATOR
      ),
    ];
  }

  if (currentTarget.afterRequestHooks) {
    currentInheritedConfig.afterRequestHooks = [
      ...currentTarget.afterRequestHooks,
    ];
  } else if (inheritedConfig.afterRequestHooks) {
    currentInheritedConfig.afterRequestHooks = [
      ...inheritedConfig.afterRequestHooks,
    ];
    currentTarget.afterRequestHooks = [...inheritedConfig.afterRequestHooks];
  }

  if (currentTarget.beforeRequestHooks) {
    currentInheritedConfig.beforeRequestHooks = [
      ...currentTarget.beforeRequestHooks,
    ];
  } else if (inheritedConfig.beforeRequestHooks) {
    currentInheritedConfig.beforeRequestHooks = [
      ...inheritedConfig.beforeRequestHooks,
    ];
    currentTarget.beforeRequestHooks = [...inheritedConfig.beforeRequestHooks];
  }

  currentTarget.overrideParams = {
    ...currentInheritedConfig.overrideParams,
  };

  currentTarget.retry = {
    ...currentInheritedConfig.retry,
  };

  currentTarget.cache = {
    ...currentInheritedConfig.cache,
  };

  currentTarget.defaultInputGuardrails = [
    ...currentInheritedConfig.defaultInputGuardrails,
  ];
  currentTarget.defaultOutputGuardrails = [
    ...currentInheritedConfig.defaultOutputGuardrails,
  ];
  // end: merge inherited config with current target config (preference given to current)

  const isHandlingCircuitBreaker = currentInheritedConfig.id;
  if (isHandlingCircuitBreaker) {
    const healthyTargets = (currentTarget.targets || [])
      .map((t: any, index: number) => ({
        ...t,
        originalIndex: index,
      }))
      .filter((t: any) => !t.isOpen);

    if (healthyTargets.length) {
      currentTarget.targets = healthyTargets;
    }
  }

  let response;

  // Use strategy pattern for target execution
  if (strategyMode && currentTarget.targets) {
    try {
      const strategy = StrategyFactory.create(strategyMode);
      const context: StrategyContext = {
        c,
        request,
        requestHeaders,
        fn,
        method,
        currentJsonPath,
      };
      
      response = await strategy.execute(
        context,
        currentTarget.targets,
        currentInheritedConfig,
        currentJsonPath
      );
    } catch (error: any) {
      if (error.name === 'RouterError') {
        throw error;
      }
      return RequestErrorHandler.handleTargetRecursionError(error);
    }
  }

    default:
      try {
        response = await tryPost(
          c,
          currentTarget,
          request,
          requestHeaders,
          fn,
          currentJsonPath,
          method
        );
        if (isHandlingCircuitBreaker) {
          await c.get('handleCircuitBreakerResponse')?.(
            response,
            currentInheritedConfig.id,
            currentTarget.cbConfig,
            currentJsonPath,
            c
          );
        }
      } catch (error: any) {
        // tryPost always returns a Response.
        // TypeError will check for all unhandled exceptions.
        // GatewayError will check for all handled exceptions which cannot allow the request to proceed.
        response = RequestErrorHandler.handleTargetRecursionError(error);
      }
      break;
  }

  return response!;
}

export function constructConfigFromRequestHeaders(
  requestHeaders: Record<string, any>
): Options | Targets {
  return ProviderConfigBuilder.build(requestHeaders);
}

export async function recursiveAfterRequestHookHandler(
  requestContext: RequestContext,
  options: any,
  retryAttemptsMade: any,
  hookSpanId: string,
  providerContext: ProviderContext,
  hooksService: HooksService,
  logObject: LogObjectBuilder
): Promise<{
  mappedResponse: Response;
  retryCount: number;
  createdAt: Date;
  originalResponseJson?: Record<string, any> | null;
}> {
  const {
    honoContext: c,
    providerOption,
    isStreaming: isStreamingMode,
    params: gatewayParams,
    endpoint: fn,
    strictOpenAiCompliance,
    requestTimeout,
    retryConfig: retry,
  } = requestContext;

  let response, retryCount, createdAt, retrySkipped;

  const requestHandler = providerContext.getRequestHandler(requestContext);
  const url = requestContext.requestURL;

  ({
    response,
    attempt: retryCount,
    createdAt,
    skip: retrySkipped,
  } = await retryRequest(
    url,
    options,
    retry.attempts,
    retry.onStatusCodes,
    requestTimeout,
    requestHandler,
    retry.useRetryAfterHeader
  ));

  // Check if sync hooks are available
  // This will be used to determine if we need to parse the response body or simply passthrough the response as is
  const areSyncHooksAvailable = hooksService.areSyncHooksAvailable;

  const {
    response: mappedResponse,
    responseJson: mappedResponseJson,
    originalResponseJson,
  } = await responseHandler(
    response,
    isStreamingMode,
    providerOption,
    fn,
    url,
    false,
    gatewayParams,
    strictOpenAiCompliance,
    c.req.url,
    areSyncHooksAvailable
  );

  const arhResponse = await afterRequestHookHandler(
    c,
    mappedResponse,
    mappedResponseJson,
    hookSpanId,
    retryAttemptsMade
  );

  const remainingRetryCount =
    (retry?.attempts || 0) - (retryCount || 0) - retryAttemptsMade;

  const isRetriableStatusCode = retry?.onStatusCodes?.includes(
    arhResponse.status
  );

  if (remainingRetryCount > 0 && !retrySkipped && isRetriableStatusCode) {
    // Log the request here since we're about to retry
    logObject
      .updateRequestContext(requestContext, options.headers)
      .addResponse(arhResponse, originalResponseJson)
      .addExecutionTime(createdAt)
      .log();

    return recursiveAfterRequestHookHandler(
      requestContext,
      options,
      (retryCount ?? 0) + 1 + retryAttemptsMade,
      hookSpanId,
      providerContext,
      hooksService,
      logObject
    );
  }

  let lastAttempt = (retryCount || 0) + retryAttemptsMade;
  if (
    (lastAttempt === (retry?.attempts || 0) && isRetriableStatusCode) ||
    retrySkipped
  ) {
    lastAttempt = -1; // All retry attempts exhausted without success.
  }

  return {
    mappedResponse: arhResponse,
    retryCount: lastAttempt,
    createdAt,
    originalResponseJson,
  };
}

export async function beforeRequestHookHandler(
  c: Context,
  hookSpanId: string
): Promise<any> {
  let span: HookSpan;
  let isTransformed = false;
  
  try {
    const start = new Date();
    const hooksManager = c.get('hooksManager');
    const hooksResult = await hooksManager.executeHooks(
      hookSpanId,
      ['syncBeforeRequestHook'],
      {
        env: env(c),
        getFromCacheByKey: c.get('getFromCacheByKey'),
        putInCacheWithValue: c.get('putInCacheWithValue'),
      }
    );
    
    span = hooksManager.getSpan(hookSpanId) as HookSpan;
    isTransformed = span.getContext().request.isTransformed;

    if (hooksResult.shouldDeny) {
      return {
        response: RequestErrorHandler.createHooksFailureResponse(hooksResult.results, start),
        createdAt: start,
        transformedBody: isTransformed ? span.getContext().request.json : null,
      };
    }
  } catch (err) {
    return RequestErrorHandler.handleBeforeRequestHookError(err);
  }
  
  return {
    transformedBody: isTransformed ? span.getContext().request.json : null,
  };
}
