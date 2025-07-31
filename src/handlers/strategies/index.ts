import { Context } from 'hono';
import { Response } from 'hono';
import { Params, StrategyModes, Targets } from '../../types/requestBody';
import { endpointStrings } from '../../providers/types';
import { StrategyContext, TargetExecutionResult, InheritedConfigData } from '../types';

export interface TargetStrategy {
  execute(
    context: StrategyContext,
    targets: any[],
    inheritedConfig: InheritedConfigData,
    currentJsonPath: string
  ): Promise<Response>;
}

export class StrategyFactory {
  private static readonly strategies: Record<StrategyModes, new() => TargetStrategy> = {
    [StrategyModes.FALLBACK]: FallbackStrategy,
    [StrategyModes.LOADBALANCE]: LoadBalanceStrategy,
    [StrategyModes.CONDITIONAL]: ConditionalStrategy,
    [StrategyModes.SINGLE]: SingleStrategy,
  };

  static create(mode: StrategyModes): TargetStrategy {
    const StrategyClass = this.strategies[mode];
    if (!StrategyClass) {
      throw new Error(`Unknown strategy mode: ${mode}`);
    }
    return new StrategyClass();
  }
}

// Re-export strategy implementations
export { FallbackStrategy } from './fallbackStrategy';
export { LoadBalanceStrategy } from './loadBalanceStrategy';
export { ConditionalStrategy } from './conditionalStrategy';
export { SingleStrategy } from './singleStrategy';