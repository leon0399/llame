/**
 * Per-tool rerank settings for the decision lane. They live beside the tool's
 * own settings — `webSearch.rerank` and `tools.grep.rerank` — because the tool,
 * not the lane, decides whether it ranks and which catalogue model judges it.
 * An absent block means no ranking; there is no mode field.
 */

/** Resolved rerank settings of one tool. */
export type ToolRerankConfig = {
  /** A `decisionModels[].id` or `rerankModels[].id`; the boot loader proves it exists. */
  readonly model: string;
};

/** The still-uninterpolated block, once the published schema has validated it. */
export type RawToolRerankConfig = {
  model: string;
};
