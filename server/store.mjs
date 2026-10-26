import fs from 'node:fs/promises';
import path from 'node:path';
export class Store {
  constructor(directory) { this.directory = directory; this.pending = Promise.resolve(); }
  async read(name, fallback) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, name + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${name}.json: ${error.message}`); }
  }
  write(name, data) {
    const text = JSON.stringify(data, null, 2);
    const next = this.pending.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const target = path.join(this.directory, name + '.json');
      await fs.writeFile(target + '.tmp', text);
      await fs.rename(target + '.tmp', target);
    });
    this.pending = next;
    return next;
  }
}
