import { invokeEdgeFunction } from "./edge-functions";

export type HealthScoreInput = {
  address?: string;
  cad?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
};

export type HealthScoreResult = {
  score: number;
  summary: string;
  factors: string[];
};

export async function getHealthScore(input: HealthScoreInput): Promise<HealthScoreResult> {
  return invokeEdgeFunction<HealthScoreResult>("ai-health-score", input);
}
