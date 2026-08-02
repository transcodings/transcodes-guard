import {
  RulesProcessor,
  RulesProcessorToolTargetSchema,
  toolRuleFactories,
} from '../features/rules/rules-processor.js';
import {
  SkillsProcessor,
  SkillsProcessorToolTargetSchema,
  toolSkillFactories,
} from '../features/skills/skills-processor.js';
import type { Feature } from './features.js';
import type { ToolTarget } from './tool-targets.js';

// Common surface every feature processor exposes. `getToolTargets`/`Simulated`
// are static, so they are reached through the class reference.
type ProcessorClass = {
  getToolTargets(options?: {
    global?: boolean;
    importOnly?: boolean;
  }): ToolTarget[];
  getToolTargetsSimulated?: () => ToolTarget[];
};

type FactoryMap = ReadonlyMap<ToolTarget, unknown>;

// Only `options` (the enum members) is consumed by registry readers, so the
// schema is typed by that surface rather than each feature's distinct enum type.
type ToolTargetSchema = { readonly options: ReadonlyArray<string> };

export type ProcessorRegistryEntry = {
  readonly feature: Feature;
  readonly processor: ProcessorClass;
  readonly schema: ToolTargetSchema;
  readonly factory: FactoryMap;
};

// Single place that binds each feature to its processor, schema and factory.
// This slim Transcodes fork only registers rules + skills — see
// `src/types/features.ts` and `src/types/tool-target-tuples.ts`.
export const PROCESSOR_REGISTRY: ReadonlyArray<ProcessorRegistryEntry> = [
  {
    feature: 'rules',
    processor: RulesProcessor,
    schema: RulesProcessorToolTargetSchema,
    factory: toolRuleFactories,
  },
  {
    feature: 'skills',
    processor: SkillsProcessor,
    schema: SkillsProcessorToolTargetSchema,
    factory: toolSkillFactories,
  },
];

export const getProcessorRegistryEntry = (
  feature: Feature,
): ProcessorRegistryEntry => {
  const entry = PROCESSOR_REGISTRY.find((e) => e.feature === feature);
  if (!entry) {
    throw new Error(`No processor registered for feature: ${feature}`);
  }
  return entry;
};
