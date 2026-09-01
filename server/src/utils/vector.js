export function toVectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Embedding vector is empty");
  }

  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}
