import { Response } from 'hono';
import { TargetStrategy } from './index';
import { StrategyContext, InheritedConfigData } from '../types';
import { STRATEGY_CONFIG } from '../constants';

export class SingleStrategy implements TargetStrategy {
  async execute(
    context: StrategyContext,
    targets: any[],
    inheritedConfig: InheritedConfigData,
    currentJsonPath: string
  ): Promise<Response> {
    if (!targets || targets.length === 0) {
      throw new Error('No targets available for single strategy');
    }

    const target = targets[STRATEGY_CONFIG.SINGLE_TARGET_INDEX];
    const originalIndex = target.originalIndex || STRATEGY_CONFIG.SINGLE_TARGET_INDEX;
    const targetJsonPath = `${currentJsonPath}.targets[${originalIndex}]`;

    return this.tryTarget(context, target, inheritedConfig, targetJsonPath);
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