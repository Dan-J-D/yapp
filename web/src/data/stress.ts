// Contrastive stress sets: the same sentence with the operative word in 4 positions.
// Each stress placement answers a different implied question.
export interface StressSet {
  id: string;
  sentence: string;
  targets: { word: string; idx: number; meaning: string }[];
}

const mk = (id: string, sentence: string, t: [number, string][]): StressSet => {
  const ws = sentence.split(/\s+/);
  return { id, sentence, targets: t.map(([idx, meaning]) => ({ word: ws[idx].replace(/[^\w']/g, ''), idx, meaning })) };
};

export const STRESS_SETS: StressSet[] = [
  mk('s1', 'I never said she stole my money.', [[0, 'Someone else said it.'], [1, 'I deny ever saying it.'], [3, 'Someone else stole it.'], [6, 'She stole something else.']]),
  mk('s2', 'We should meet on Friday at noon.', [[0, 'Not them — us.'], [2, 'Not call — meet.'], [4, 'Not Thursday.'], [6, 'Not in the evening.']]),
  mk('s3', 'Can you bring the blue folder tomorrow?', [[0, 'Is it possible?'], [1, 'You specifically.'], [4, 'Not the red one.'], [6, 'Not today.']]),
  mk('s4', 'My brother bought a new car yesterday.', [[0, 'Mine, not yours.'], [1, 'Not my sister.'], [4, 'Not a used one.'], [6, 'Not last week.']]),
  mk('s5', 'She wants to visit Spain next summer.', [[0, 'Not him.'], [1, 'It’s her wish, not a plan.'], [4, 'Not Italy.'], [6, 'Not winter.']]),
  mk('s6', 'This coffee tastes better than yesterday.', [[0, 'This one, not that one.'], [1, 'Not the tea.'], [3, 'Not worse.'], [5, 'Compared to yesterday.']]),
  mk('s7', 'I left my keys in the kitchen.', [[0, 'Not you.'], [2, 'My own keys.'], [3, 'Not my phone.'], [6, 'Not the car.']]),
  mk('s8', 'They finished the project two weeks early.', [[0, 'Not us.'], [1, 'Finished, not started.'], [4, 'Not one or three.'], [6, 'Not late.']]),
  mk('s9', 'He only reads books about history.', [[0, 'Him, not her.'], [1, 'Nothing else.'], [3, 'Not magazines.'], [5, 'Not science.']]),
  mk('s10', 'Our team won the final match easily.', [[0, 'Ours, not theirs.'], [2, 'Won, not lost.'], [4, 'The final, not the semi.'], [6, 'Without trouble.']]),
];
