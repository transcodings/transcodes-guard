/**
 * Result of writing AI files, including both count and file paths
 */
export type WriteResult = {
  count: number;
  paths: string[];
};

/**
 * Result of feature generation, extending WriteResult with hasDiff
 */
export type FeatureGenerateResult = WriteResult & { hasDiff: boolean };

/**
 * Common count fields shared by ImportResult / ConvertResult / GenerateResult
 * in the slim Transcodes fork (rules + skills only).
 */
export type CountableResult = {
  rulesCount: number;
  skillsCount: number;
};

/**
 * Calculate the total count from a result object
 */
export function calculateTotalCount(result: CountableResult): number {
  return result.rulesCount + result.skillsCount;
}
