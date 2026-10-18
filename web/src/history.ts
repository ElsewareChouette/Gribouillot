/**
 * Undo/redo by snapshots: the layers are immutable data, so an entry only
 * keeps a reference to the previous `layers` array.
 */

import type { Layer } from './model';

interface Entry {
  label: string;
  before: Layer[];
  after: Layer[];
  mergeKey?: string;
  time: number;
}

const LIMIT = 200;
const MERGE_DELAY = 1500; // ms

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Record a change. Successive changes with the same mergeKey (e.g. rotating
   * a picture key press after key press) become a single undo step.
   */
  push(label: string, before: Layer[], after: Layer[], mergeKey?: string): void {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (mergeKey && last?.mergeKey === mergeKey && now - last.time < MERGE_DELAY) {
      last.after = after;
      last.time = now;
    } else {
      this.undoStack.push({ label, before, after, mergeKey, time: now });
      if (this.undoStack.length > LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): Entry | undefined {
    const e = this.undoStack.pop();
    if (e) this.redoStack.push(e);
    return e;
  }

  redo(): Entry | undefined {
    const e = this.redoStack.pop();
    if (e) this.undoStack.push(e);
    return e;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }
}
