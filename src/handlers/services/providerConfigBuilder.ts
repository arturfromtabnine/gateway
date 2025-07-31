import {
  AZURE_OPEN_AI,
  BEDROCK,
  WORKERS_AI,
  POWERED_BY,
  GOOGLE_VERTEX_AI,
  OPEN_AI,
  AZURE_AI_INFERENCE,
  ANTHROPIC,
  HUGGING_FACE,
  STABILITY_AI,
  SAGEMAKER,
  FIREWORKS_AI,
  CORTEX,
} from '../../globals';
import { Options, Targets } from '../../types/requestBody';
import { convertKeysToCamelCase } from '../../utils';
import { AzureConfig, AwsConfig, StabilityAiConfig, ProviderConfigMap } from '../types';

export class ProviderConfigBuilder {
  private static readonly CAMEL_CASE_EXCLUSIONS = [
    'override_params',
    'params',
    'checks',
    'vertex_service_account_json',
    'vertexServiceAccountJson',
    'conditions',
    'input_guardrails',
    'output_guardrails',
    'default_input_guardrails',
    'default_output_guardrails',
    'integrationModelDetails',
    'cb_config',
  ];

  /**
   * Main entry point for building provider configuration
   */
  static build(requestHeaders: Record<string, any>): Options | Targets {
    const baseConfig = this.buildBaseConfig(requestHeaders);
    
    if (requestHeaders[`x-${POWERED_BY}-config`]) {
      return this.buildFromConfigHeader(requestHeaders, baseConfig);
    }
    
    return this.buildFromIndividualHeaders(requestHeaders, baseConfig);
  }

  /**
   * Builds configuration from the x-portkey-config header
   */
  private static buildFromConfigHeader(
    requestHeaders: Record<string, any>,
    baseConfig: any
  ): Options | Targets {
    let parsedConfigJson = JSON.parse(requestHeaders[`x-${POWERED_BY}-config`]);
    
    // Add default guardrails
    parsedConfigJson.default_input_guardrails = baseConfig.input_guardrails;
    parsedConfigJson.default_output_guardrails = baseConfig.output_guardrails;

    // If no provider or targets specified, build from headers
    if (!parsedConfigJson.provider && !parsedConfigJson.targets) {
      parsedConfigJson = this.enhanceConfigWithProviderSpecifics(
        parsedConfigJson,
        requestHeaders
      );
    }

    return convertKeysToCamelCase(parsedConfigJson, this.CAMEL_CASE_EXCLUSIONS) as any;
  }

  /**
   * Builds configuration from individual headers when no config header is present
   */
  private static buildFromIndividualHeaders(
    requestHeaders: Record<string, any>,
    baseConfig: any
  ): Options {
    const provider = requestHeaders[`x-${POWERED_BY}-provider`];
    
    const config: Options = {
      provider,
      apiKey: requestHeaders['authorization']?.replace('Bearer ', ''),
      defaultInputGuardrails: baseConfig.input_guardrails,
      defaultOutputGuardrails: baseConfig.output_guardrails,
    };

    // Add provider-specific configurations
    return this.addProviderSpecificConfig(config, provider, requestHeaders);
  }

  /**
   * Builds base configuration with default guardrails
   */
  private static buildBaseConfig(requestHeaders: Record<string, any>) {
    return {
      input_guardrails: requestHeaders[`x-portkey-default-input-guardrails`]
        ? JSON.parse(requestHeaders[`x-portkey-default-input-guardrails`])
        : [],
      output_guardrails: requestHeaders[`x-portkey-default-output-guardrails`]
        ? JSON.parse(requestHeaders[`x-portkey-default-output-guardrails`])
        : [],
    };
  }

  /**
   * Enhances parsed config with provider-specific settings
   */
  private static enhanceConfigWithProviderSpecifics(
    parsedConfig: any,
    requestHeaders: Record<string, any>
  ): any {
    const provider = requestHeaders[`x-${POWERED_BY}-provider`];
    
    parsedConfig.provider = provider;
    parsedConfig.api_key = requestHeaders['authorization']?.replace('Bearer ', '');

    return this.addProviderSpecificConfig(parsedConfig, provider, requestHeaders);
  }

  /**
   * Adds provider-specific configuration based on provider type
   */
  private static addProviderSpecificConfig(
    config: any,
    provider: string,
    requestHeaders: Record<string, any>
  ): any {
    const providerConfigs = {
      [AZURE_OPEN_AI]: () => ({ ...config, ...this.buildAzureConfig(requestHeaders) }),
      [BEDROCK]: () => ({ ...config, ...this.buildAwsConfig(requestHeaders) }),
      [SAGEMAKER]: () => ({ 
        ...config, 
        ...this.buildAwsConfig(requestHeaders),
        ...this.buildSagemakerConfig(requestHeaders)
      }),
      [WORKERS_AI]: () => ({ ...config, ...this.buildWorkersAiConfig(requestHeaders) }),
      [GOOGLE_VERTEX_AI]: () => ({ ...config, ...this.buildVertexConfig(requestHeaders) }),
      [AZURE_AI_INFERENCE]: () => ({ ...config, ...this.buildAzureAiInferenceConfig(requestHeaders) }),
      [OPEN_AI]: () => ({ ...config, ...this.buildOpenAiConfig(requestHeaders) }),
      [ANTHROPIC]: () => ({ ...config, ...this.buildAnthropicConfig(requestHeaders) }),
      [HUGGING_FACE]: () => ({ ...config, ...this.buildHuggingfaceConfig(requestHeaders) }),
      [STABILITY_AI]: () => ({ ...config, ...this.buildStabilityAiConfig(requestHeaders) }),
      [FIREWORKS_AI]: () => ({ ...config, ...this.buildFireworksConfig(requestHeaders) }),
      [CORTEX]: () => ({ ...config, ...this.buildCortexConfig(requestHeaders) }),
    };

    const configBuilder = providerConfigs[provider];
    if (configBuilder) {
      return configBuilder();
    }

    // Add any remaining provider-specific configs
    if (requestHeaders[`x-${POWERED_BY}-mistral-fim-completion`]) {
      config.mistralFimCompletion = requestHeaders[`x-${POWERED_BY}-mistral-fim-completion`];
    }

    return config;
  }

  /**
   * Provider-specific configuration builders
   */
  private static buildAzureConfig(headers: Record<string, any>): AzureConfig {
    return {
      resourceName: headers[`x-${POWERED_BY}-azure-resource-name`],
      deploymentId: headers[`x-${POWERED_BY}-azure-deployment-id`],
      apiVersion: headers[`x-${POWERED_BY}-azure-api-version`],
      azureAdToken: headers[`x-${POWERED_BY}-azure-ad-token`],
      azureAuthMode: headers[`x-${POWERED_BY}-azure-auth-mode`],
      azureManagedClientId: headers[`x-${POWERED_BY}-azure-managed-client-id`],
      azureEntraClientId: headers[`x-${POWERED_BY}-azure-entra-client-id`],
      azureEntraClientSecret: headers[`x-${POWERED_BY}-azure-entra-client-secret`],
      azureEntraTenantId: headers[`x-${POWERED_BY}-azure-entra-tenant-id`],
      azureModelName: headers[`x-${POWERED_BY}-azure-model-name`],
      openaiBeta: headers[`x-${POWERED_BY}-openai-beta`] || headers[`openai-beta`],
    };
  }

  private static buildAwsConfig(headers: Record<string, any>): AwsConfig {
    return {
      awsAccessKeyId: headers[`x-${POWERED_BY}-aws-access-key-id`],
      awsSecretAccessKey: headers[`x-${POWERED_BY}-aws-secret-access-key`],
      awsSessionToken: headers[`x-${POWERED_BY}-aws-session-token`],
      awsRegion: headers[`x-${POWERED_BY}-aws-region`],
      awsRoleArn: headers[`x-${POWERED_BY}-aws-role-arn`],
      awsAuthType: headers[`x-${POWERED_BY}-aws-auth-type`],
      awsExternalId: headers[`x-${POWERED_BY}-aws-external-id`],
      awsS3Bucket: headers[`x-${POWERED_BY}-aws-s3-bucket`],
      awsS3ObjectKey: headers[`x-${POWERED_BY}-aws-s3-object-key`] || 
                      headers[`x-${POWERED_BY}-provider-file-name`],
      awsBedrockModel: headers[`x-${POWERED_BY}-aws-bedrock-model`] || 
                       headers[`x-${POWERED_BY}-provider-model`],
      awsServerSideEncryption: headers[`x-${POWERED_BY}-amz-server-side-encryption`],
      awsServerSideEncryptionKMSKeyId: headers[`x-${POWERED_BY}-amz-server-side-encryption-aws-kms-key-id`],
    };
  }

  private static buildSagemakerConfig(headers: Record<string, any>) {
    return {
      amznSagemakerCustomAttributes: headers[`x-${POWERED_BY}-amzn-sagemaker-custom-attributes`],
      amznSagemakerTargetModel: headers[`x-${POWERED_BY}-amzn-sagemaker-target-model`],
      amznSagemakerTargetVariant: headers[`x-${POWERED_BY}-amzn-sagemaker-target-variant`],
      amznSagemakerTargetContainerHostname: headers[`x-${POWERED_BY}-amzn-sagemaker-target-container-hostname`],
      amznSagemakerInferenceId: headers[`x-${POWERED_BY}-amzn-sagemaker-inference-id`],
      amznSagemakerEnableExplanations: headers[`x-${POWERED_BY}-amzn-sagemaker-enable-explanations`],
      amznSagemakerInferenceComponent: headers[`x-${POWERED_BY}-amzn-sagemaker-inference-component`],
      amznSagemakerSessionId: headers[`x-${POWERED_BY}-amzn-sagemaker-session-id`],
      amznSagemakerModelName: headers[`x-${POWERED_BY}-amzn-sagemaker-model-name`],
    };
  }

  private static buildStabilityAiConfig(headers: Record<string, any>): StabilityAiConfig {
    return {
      stabilityClientId: headers[`x-${POWERED_BY}-stability-client-id`],
      stabilityClientUserId: headers[`x-${POWERED_BY}-stability-client-user-id`],
      stabilityClientVersion: headers[`x-${POWERED_BY}-stability-client-version`],
    };
  }

  private static buildAzureAiInferenceConfig(headers: Record<string, any>) {
    return {
      azureApiVersion: headers[`x-${POWERED_BY}-azure-api-version`],
      azureEndpointName: headers[`x-${POWERED_BY}-azure-endpoint-name`],
      azureFoundryUrl: headers[`x-${POWERED_BY}-azure-foundry-url`],
      azureExtraParams: headers[`x-${POWERED_BY}-azure-extra-params`],
    };
  }

  private static buildWorkersAiConfig(headers: Record<string, any>) {
    return {
      workersAiAccountId: headers[`x-${POWERED_BY}-workers-ai-account-id`],
    };
  }

  private static buildOpenAiConfig(headers: Record<string, any>) {
    return {
      openaiOrganization: headers[`x-${POWERED_BY}-openai-organization`],
      openaiProject: headers[`x-${POWERED_BY}-openai-project`],
      openaiBeta: headers[`x-${POWERED_BY}-openai-beta`] || headers[`openai-beta`],
    };
  }

  private static buildHuggingfaceConfig(headers: Record<string, any>) {
    return {
      huggingfaceBaseUrl: headers[`x-${POWERED_BY}-huggingface-base-url`],
    };
  }

  private static buildVertexConfig(headers: Record<string, any>) {
    const config: Record<string, any> = {
      vertexProjectId: headers[`x-${POWERED_BY}-vertex-project-id`],
      vertexRegion: headers[`x-${POWERED_BY}-vertex-region`],
      vertexStorageBucketName: headers[`x-${POWERED_BY}-vertex-storage-bucket-name`],
      filename: headers[`x-${POWERED_BY}-provider-file-name`],
      vertexModelName: headers[`x-${POWERED_BY}-provider-model`],
      vertexBatchEndpoint: headers[`x-${POWERED_BY}-provider-batch-endpoint`],
    };

    const vertexServiceAccountJson = headers[`x-${POWERED_BY}-vertex-service-account-json`];
    if (vertexServiceAccountJson) {
      try {
        config.vertexServiceAccountJson = JSON.parse(vertexServiceAccountJson);
      } catch (e) {
        config.vertexServiceAccountJson = null;
      }
    }

    return config;
  }

  private static buildFireworksConfig(headers: Record<string, any>) {
    return {
      fireworksAccountId: headers[`x-${POWERED_BY}-fireworks-account-id`],
      fireworksFileLength: headers[`x-${POWERED_BY}-file-upload-size`],
    };
  }

  private static buildAnthropicConfig(headers: Record<string, any>) {
    return {
      anthropicBeta: headers[`x-${POWERED_BY}-anthropic-beta`],
      anthropicVersion: headers[`x-${POWERED_BY}-anthropic-version`],
    };
  }

  private static buildCortexConfig(headers: Record<string, any>) {
    return {
      snowflakeAccount: headers[`x-${POWERED_BY}-snowflake-account`],
    };
  }
}