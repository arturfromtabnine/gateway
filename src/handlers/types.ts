import { Response } from 'hono';
import { HooksService } from './services/hooksService';
import { ProviderContext } from './services/providerContext';
import { LogsService } from './services/logsService';
import { ResponseService } from './services/responseService';
import { CacheService } from './services/cacheService';
import { PreRequestValidatorService } from './services/preRequestValidatorService';
import { RequestContext } from './services/requestContext';
import { HookType } from '../middlewares/hooks/types';

export interface ServiceContainer {
  hooksService: HooksService;
  providerContext: ProviderContext;
  logsService: LogsService;
  responseService: ResponseService;
  cacheService: CacheService;
  preRequestValidator: PreRequestValidatorService;
}

export interface RequestProcessingResult {
  mappedResponse: Response;
  retryCount: number;
  createdAt: Date;
  originalResponseJson?: Record<string, any> | null;
}

export interface HookProcessingResult {
  response?: Response;
  createdAt?: Date;
  transformedBody?: any;
}

export interface CacheProcessingResult {
  response?: Response;
  cacheStatus?: string;
  cacheKey?: string;
  createdAt?: Date;
}

export interface ValidationProcessingResult {
  response?: Response;
}

export interface ProviderConfigMap {
  [key: string]: any;
}

export interface AzureConfig {
  resourceName?: string;
  deploymentId?: string;
  apiVersion?: string;
  azureAdToken?: string;
  azureAuthMode?: string;
  azureManagedClientId?: string;
  azureEntraClientId?: string;
  azureEntraClientSecret?: string;
  azureEntraTenantId?: string;
  azureModelName?: string;
  openaiBeta?: string;
}

export interface AwsConfig {
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  awsRegion?: string;
  awsRoleArn?: string;
  awsAuthType?: string;
  awsExternalId?: string;
  awsS3Bucket?: string;
  awsS3ObjectKey?: string;
  awsBedrockModel?: string;
  awsServerSideEncryption?: string;
  awsServerSideEncryptionKMSKeyId?: string;
}

export interface StabilityAiConfig {
  stabilityClientId?: string;
  stabilityClientUserId?: string;
  stabilityClientVersion?: string;
}

export interface HookShorthandInput {
  deny?: boolean;
  on_fail?: string;
  on_success?: string;
  async?: boolean;
  id?: string;
  type?: string;
  guardrail_version_id?: string;
  is_enabled?: boolean;
  [key: string]: any;
}

export interface ProcessedHookObject {
  type: HookType;
  id: string;
  deny?: boolean;
  onFail?: string;
  onSuccess?: string;
  async?: boolean;
  guardrailVersionId?: string;
  checks: Array<{
    id: string;
    parameters: any;
    is_enabled?: boolean;
  }>;
}

export interface HeaderProcessingOptions {
  shouldProcessProxy: boolean;
  forwardHeaders: string[];
  customHeadersToIgnore?: string[];
}

export interface StrategyContext {
  c: any; // Hono Context
  request: any;
  requestHeaders: Record<string, string>;
  fn: string;
  method: string;
  currentJsonPath: string;
}

export interface TargetExecutionResult {
  response: Response;
  targetIndex: number;
}

export interface CircuitBreakerConfig {
  isHandling: boolean;
  id?: string;
  config?: any;
}

export interface InheritedConfigData {
  id?: string;
  overrideParams?: Record<string, any>;
  retry?: any;
  cache?: any;
  requestTimeout?: number | null;
  defaultInputGuardrails?: any[];
  defaultOutputGuardrails?: any[];
  strictOpenAiCompliance?: boolean;
  forwardHeaders?: string[];
  customHost?: string;
  afterRequestHooks?: any[];
  beforeRequestHooks?: any[];
}