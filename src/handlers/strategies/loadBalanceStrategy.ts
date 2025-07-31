import { Response } from 'hono';
import { TargetStrategy } from './index';
import { StrategyContext, InheritedConfigData } from '../types';
import { REQUEST_PROCESSING } from '../constants';

export class LoadBalanceStrategy implements TargetStrategy {
  async execute(
    context: StrategyContext,
    targets: any[],
    inheritedConfig: InheritedConfigData,
    currentJsonPath: string
  ): Promise<Response> {
    // Ensure all targets have weights
    const weightedTargets = this.assignDefaultWeights(targets);
    
    const selectedTarget = this.selectTargetByWeight(weightedTargets);
    const targetJsonPath = `${currentJsonPath}.targets[${selectedTarget.originalIndex}]`;

    return this.tryTarget(context, selectedTarget.target, inheritedConfig, targetJsonPath);
  }

  private assignDefaultWeights(targets: any[]): any[] {
    return targets.map(target => ({
      ...target,
      weight: target.weight ?? REQUEST_PROCESSING.DEFAULT_WEIGHT
    }));
  }

  private selectTargetByWeight(targets: any[]): { target: any; originalIndex: number } {
    const totalWeight = targets.reduce(
      (sum: number, target: any) => sum + target.weight,
      0
    );

    if (totalWeight === 0) {
      throw new Error('Total weight cannot be zero for load balancing');
    }

    let randomWeight = Math.random() * totalWeight;

    for (const [index, target] of targets.entries()) {
      if (randomWeight < target.weight) {
        return {
          target,
          originalIndex: target.originalIndex || index
        };
      }
      randomWeight -= target.weight;
    }

    // Fallback to last target (should not happen with proper weights)
    const lastTarget = targets[targets.length - 1];
    return {
      target: lastTarget,
      originalIndex: lastTarget.originalIndex || targets.length - 1
    };
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