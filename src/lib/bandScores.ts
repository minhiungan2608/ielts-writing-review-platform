// Criterion-average rounding retained from the original application.
export function calculateIELTSOverallBand(scores: {
  task_criterion_score: number | null;
  cc_score: number | null;
  lr_score: number | null;
  gra_score: number | null;
}): number | null {
  const { task_criterion_score, cc_score, lr_score, gra_score } = scores;
  if (
    task_criterion_score === null ||
    cc_score === null ||
    lr_score === null ||
    gra_score === null ||
    isNaN(task_criterion_score) ||
    isNaN(cc_score) ||
    isNaN(lr_score) ||
    isNaN(gra_score)
  ) {
    return null;
  }

  const mean = (task_criterion_score + cc_score + lr_score + gra_score) / 4;
  const whole = Math.floor(mean);
  const remainder = mean - whole;

  if (remainder < 0.25) {
    return whole;
  } else if (remainder < 0.75) {
    return whole + 0.5;
  } else {
    return whole + 1;
  }
}

