import { z } from 'zod/mini';

/** Transcodes slim fork: rules + skills only. */
export const ALL_FEATURES = ['rules', 'skills'] as const;

export const ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, '*'] as const;

const FeatureSchema = z.enum(ALL_FEATURES);

export type Feature = z.infer<typeof FeatureSchema>;

const FeaturesSchema = z.array(FeatureSchema);

export type Features = z.infer<typeof FeaturesSchema>;

type FeatureWithWildcard = Feature | '*';
const FeatureWithWildcardSchema = z.enum([...ALL_FEATURES, '*']);
export const GitignoreDestinationSchema = z.enum([
  'gitignore',
  'gitattributes',
]);
export type GitignoreDestination = z.infer<typeof GitignoreDestinationSchema>;

export const FlattenedCommandNamingSchema = z.enum(['basename', 'path']);
export type FlattenedCommandNaming = z.infer<
  typeof FlattenedCommandNamingSchema
>;

export type FeatureOptions = Record<string, unknown>;

const FeatureOptionsSchema = z.record(z.string(), z.unknown());
const FeatureValueSchema = z.union([
  z.boolean(),
  FeatureOptionsSchema,
  GitignoreDestinationSchema,
]);
const PerFeatureConfigSchema = z.record(z.string(), FeatureValueSchema);
export type PerFeatureConfig = z.infer<typeof PerFeatureConfigSchema>;
export const PerTargetFeaturesValueSchema = z.union([
  z.array(FeatureWithWildcardSchema),
  PerFeatureConfigSchema,
]);

export type PerTargetFeaturesValue = z.infer<
  typeof PerTargetFeaturesValueSchema
>;

export const RulesyncFeaturesSchema = z.union([
  z.array(FeatureWithWildcardSchema),
  z.record(z.string(), PerTargetFeaturesValueSchema),
]);

export type RulesyncFeatures = z.infer<typeof RulesyncFeaturesSchema>;

export const isFeatureValueEnabled = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  if (typeof value === 'string') return true;
  if (typeof value === 'object') return true;
  return false;
};

export { FeatureSchema, FeaturesSchema, FeatureWithWildcardSchema };
