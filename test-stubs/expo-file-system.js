const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const processId = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const documentDir = path.join(os.tmpdir(), `quimiocare-test-docs-${processId}`);
const cacheDir = path.join(os.tmpdir(), `quimiocare-test-cache-${processId}`);

if (!fs.existsSync(documentDir)) {
  fs.mkdirSync(documentDir, { recursive: true });
}
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

process.on('exit', () => {
  try {
    if (fs.existsSync(documentDir)) fs.rmSync(documentDir, { recursive: true, force: true });
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // Ignorar fallo al salir
  }
});

class Paths {
  static document = documentDir;
  static cache = cacheDir;
  static basename(p) {
    return path.basename(p);
  }
}

class File {
  constructor(...paths) {
    if (paths.length === 1 && typeof paths[0] === 'object' && paths[0] && paths[0].uri) {
      this.uri = paths[0].uri;
    } else {
      const parts = paths.map((p) =>
        typeof p === 'object' && p ? p.uri || p.path || String(p) : String(p),
      );
      this.uri = path.resolve(...parts);
    }
  }

  get exists() {
    if (fs.existsSync(this.uri) && fs.statSync(this.uri).isDirectory()) {
      throw new Error(`Path ${this.uri} is a directory, not a file`);
    }
    return fs.existsSync(this.uri);
  }

  get name() {
    return path.basename(this.uri);
  }

  get size() {
    if (!this.exists) return 0;
    return fs.statSync(this.uri).size;
  }

  get creationTime() {
    if (!this.exists) return null;
    return fs.statSync(this.uri).birthtimeMs || null;
  }

  get modificationTime() {
    if (!this.exists) return null;
    return fs.statSync(this.uri).mtimeMs || null;
  }

  async text() {
    return fs.readFileSync(this.uri, 'utf-8');
  }

  async write(content) {
    const parent = path.dirname(this.uri);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    if (typeof content === 'string') {
      fs.writeFileSync(this.uri, content, 'utf-8');
    } else {
      fs.writeFileSync(this.uri, content);
    }
  }

  async delete() {
    if (fs.existsSync(this.uri)) {
      fs.unlinkSync(this.uri);
    }
  }

  async move(dest, options) {
    const destPath = typeof dest === 'object' && dest ? dest.uri : String(dest);
    const parent = path.dirname(destPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    if (fs.existsSync(destPath) && !options?.overwrite) {
      throw new Error(`Destination file already exists and overwrite is false: ${destPath}`);
    }
    fs.renameSync(this.uri, destPath);
  }

  async copy(dest) {
    const destPath = typeof dest === 'object' && dest ? dest.uri : String(dest);
    const parent = path.dirname(destPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(this.uri, destPath);
  }
}

class Directory {
  constructor(...paths) {
    const parts = paths.map((p) =>
      typeof p === 'object' && p ? p.uri || p.path || String(p) : String(p),
    );
    this.uri = path.resolve(...parts);
  }

  get exists() {
    return fs.existsSync(this.uri) && fs.statSync(this.uri).isDirectory();
  }

  create({ intermediates = true } = {}) {
    if (!fs.existsSync(this.uri)) {
      fs.mkdirSync(this.uri, { recursive: intermediates });
    }
  }

  list() {
    if (!fs.existsSync(this.uri)) return [];
    return fs.readdirSync(this.uri).map((entry) => {
      const full = path.join(this.uri, entry);
      const isDir = fs.statSync(full).isDirectory();
      return isDir ? new Directory(full) : new File(full);
    });
  }
}

module.exports = {
  Directory,
  File,
  Paths,
};
