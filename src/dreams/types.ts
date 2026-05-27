export interface DreamEntry {
  artifact_id: string;
  title: string;
  domain: string;
  pitch: string;
  kill_reason: string;
  iteration: number;
  what_was_good: string;
  resurrection_hint: string;
  added_at: string;
}

export interface DreamJournal {
  dreams: DreamEntry[];
  updated_at: string;
}
