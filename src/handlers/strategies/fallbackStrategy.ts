import { Response } from 'hono';
import { TargetStrategy } from './index';
import { StrategyContext, InheritedConfigData } from '../types';
import { REQUEST_PROCESSING } from '../constants';

export class FallbackStrategy implements TargetStrategy {
  async execute(
    context: StrategyContext,
    targets: any[],
    inheritedConfig: InheritedConfigData,
    currentJsonPath: string
  ): Promise<Response> {
    let response: Response | undefined;

    for (const [index, target] of targets.entries()) {
      const originalIndex = target.originalIndex || index;
      const targetJsonPath = `${currentJsonPath}.targets[${originalIndex}]`;

      response = await this.tryTarget(
        context,
        target,
        inheritedConfig,
        targetJsonPath
      );

      if (this.shouldStopFallback(response, target.strategy)) {
        break;
      }
    }

    if (!response) {
      throw new Error('All fallback attempts failed');
    }

    return response;
  }

  private async tryTarget(
    context: StrategyContext,
    target: any,
    inheritedConfig: InheritedConfigData,
    targetJsonPath: string
  ): Promise<Response> {
    const { tryTargetsRecursively } = await import('../handlerUtils');
    
    return tryTargetsRecursively(
      context.c,
      target,
      context.request,
      context.requestHeaders,
      context.fn,
      context.method,
      targetJsonPath,
      inheritedConfig
    );
  }

  private shouldStopFallback(response: Response, strategy?: any): boolean {
    const codes = strategy?.onStatusCodes;
    const gatewayException = response?.headers.get(REQUEST_PROCESSING.GATEWAY_EXCEPTION_HEADER) === 'true';

    return (
      // If onStatusCodes is provided, and the response status is not in the list
      (Array.isArray(codes) && !codes.includes(response?.status)) ||
      // If onStatusCodes is not provided, and the response is ok
      (!codes && response?.ok) ||
      // If the response is a gateway exception
      gatewayException
    );
  }
}