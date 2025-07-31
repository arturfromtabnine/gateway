import { Response } from 'hono';
import { TargetStrategy } from './index';
import { StrategyContext, InheritedConfigData } from '../types';
import { HEADER_KEYS } from '../../globals';
import { ConditionalRouter } from '../../services/conditionalRouter';
import { RouterError } from '../../errors/RouterError';
import { Targets } from '../../types/requestBody';

export class ConditionalStrategy implements TargetStrategy {
  async execute(
    context: StrategyContext,
    targets: any[],
    inheritedConfig: InheritedConfigData,
    currentJsonPath: string
  ): Promise<Response> {
    const metadata = this.extractMetadata(context.requestHeaders);
    const params = this.extractParams(context.request);
    
    const selectedTarget = this.resolveConditionalTarget(
      { targets } as any, // Current target group with targets
      metadata,
      params
    );

    const originalIndex = selectedTarget.originalIndex || selectedTarget.index;
    const targetJsonPath = `${currentJsonPath}.targets[${originalIndex}]`;

    return this.tryTarget(context, selectedTarget, inheritedConfig, targetJsonPath);
  }

  private extractMetadata(requestHeaders: Record<string, string>): Record<string, string> {
    try {
      return JSON.parse(requestHeaders[HEADER_KEYS.METADATA] || '{}');
    } catch (err) {
      return {};
    }
  }

  private extractParams(request: any): any {
    // Handle different request body types
    if (request instanceof FormData ||
        request instanceof ReadableStream ||
        request instanceof ArrayBuffer) {
      return {}; // Send empty object if not JSON
    }
    
    return request;
  }

  private resolveConditionalTarget(
    currentTarget: any,
    metadata: Record<string, string>,
    params: any
  ): Targets {
    let conditionalRouter: ConditionalRouter;
    
    try {
      conditionalRouter = new ConditionalRouter(currentTarget, {
        metadata,
        params,
      });
      
      return conditionalRouter.resolveTarget();
    } catch (error: any) {
      throw new RouterError(error.message);
    }
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
}