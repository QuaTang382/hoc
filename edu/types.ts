
export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number; // Index of the correct option
  explanation: string;
}

export interface QuizSet {
  id: string;
  title: string;
  description: string;
  questions: Question[];
  createdAt: number;
  color: string;
}

export type ViewState = 'BOARD' | 'PLAYING' | 'RESULT';
