import type {
  CorpusOrigin,
  DefectQualification,
  FixtureOriginKind,
  OriginReality,
} from "./types.js";

function realityFor(kind: FixtureOriginKind): OriginReality {
  if (kind === "synthetic-regression" || kind === "synthetic-mechanism-proof") {
    return "synthetic";
  }
  if (
    kind === "official-sample" ||
    kind === "qualified-real-fixture" ||
    kind === "user-provided"
  ) {
    return "real";
  }
  return "unknown";
}

function defaultQualification(kind: FixtureOriginKind): DefectQualification {
  if (kind === "synthetic-regression" || kind === "synthetic-mechanism-proof") {
    return "synthetic-fixture";
  }
  if (kind === "official-sample" || kind === "user-provided") {
    return "observation-only";
  }
  return "unqualified";
}

export function makeCorpusOrigin(
  kind: FixtureOriginKind,
  options: {
    defectQualification?: DefectQualification;
    sourceRef?: string;
  } = {}
): CorpusOrigin {
  const reality = realityFor(kind);
  const defectQualification = options.defectQualification ?? defaultQualification(kind);

  if (reality === "synthetic" && defectQualification !== "synthetic-fixture") {
    throw new Error(
      `Synthetic origin "${kind}" cannot be registered as "${defectQualification}".`
    );
  }
  if (defectQualification === "synthetic-fixture" && reality !== "synthetic") {
    throw new Error(
      `Non-synthetic origin "${kind}" cannot use synthetic-fixture qualification.`
    );
  }
  if (defectQualification === "qualified-real-defect" && kind !== "qualified-real-fixture") {
    throw new Error(
      "qualified-real-defect requires fixture origin qualified-real-fixture."
    );
  }
  if (kind === "unknown" && defectQualification !== "unqualified") {
    throw new Error("Unknown fixture origin must remain unqualified.");
  }

  return {
    kind,
    reality,
    defectQualification,
    sourceRef: options.sourceRef,
  };
}

export function mergeCorpusOrigin(
  existing: CorpusOrigin,
  incoming: CorpusOrigin
): CorpusOrigin {
  if (
    existing.kind === incoming.kind &&
    existing.defectQualification === incoming.defectQualification &&
    existing.reality === incoming.reality
  ) {
    return existing.sourceRef ? existing : incoming;
  }

  if (incoming.kind === "unknown") return existing;
  if (existing.kind === "unknown") return incoming;

  if (existing.reality !== incoming.reality) {
    throw new Error(
      `Origin reality conflict: ${existing.kind}/${existing.reality} vs ${incoming.kind}/${incoming.reality}.`
    );
  }

  throw new Error(
    `Origin conflict: existing ${existing.kind}, incoming ${incoming.kind}. Explicit migration is required.`
  );
}
