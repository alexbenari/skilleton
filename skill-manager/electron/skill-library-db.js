const fs = require("fs");
const path = require("path");

const DEFAULT_SCHEMA_VERSION = 1;

class SkillLibraryDBError extends Error {}

function createDBAdapter({
  databasePath,
  sqliteDriver = require("node:sqlite"),
  now = () => new Date().toISOString(),
} = {}) {
  if (!databasePath) {
    throw new SkillLibraryDBError("databasePath is required.");
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new sqliteDriver.DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");

  function initialize() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_libraries(
        id INTEGER PRIMARY KEY,
        local_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills(
        id INTEGER PRIMARY KEY,
        library_id INTEGER NOT NULL REFERENCES skill_libraries(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT,
        git_source_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(library_id, name)
      );

      CREATE TABLE IF NOT EXISTS tags(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS skill_tags(
        skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(skill_id, tag_id)
      );
    `);

    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get();

    if (!row) {
      db.prepare("INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)")
        .run(String(DEFAULT_SCHEMA_VERSION));
      return;
    }

    if (row.value !== String(DEFAULT_SCHEMA_VERSION)) {
      throw new SkillLibraryDBError(
        `Unsupported schema version ${row.value}. Expected ${DEFAULT_SCHEMA_VERSION}.`
      );
    }
  }

  function close() {
    db.close();
  }

  function inTransaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures and preserve the original error.
      }
      throw error;
    }
  }

  function mapLibraryRow(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      localPath: row.local_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapSkillRow(row, tagsBySkillId) {
    return {
      id: row.id,
      libraryId: row.library_id,
      name: row.name,
      localPath: row.local_path,
      description: row.description,
      source: row.source,
      gitSourceUrl: row.git_source_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: tagsBySkillId.get(row.id) || [],
    };
  }

  function assertDiscoveredSkillsArray(discoveredSkills) {
    if (!Array.isArray(discoveredSkills)) {
      throw new SkillLibraryDBError("discoveredSkills must be an array.");
    }
  }

  function uniqueNames(skills) {
    const names = new Set();
    for (const skill of skills) {
      if (!skill || typeof skill !== "object") {
        throw new SkillLibraryDBError("Each discovered skill must be an object.");
      }
      if (!skill.name || typeof skill.name !== "string") {
        throw new SkillLibraryDBError("Each discovered skill must include a name.");
      }
      if (names.has(skill.name)) {
        throw new SkillLibraryDBError(`Duplicate discovered skill name: ${skill.name}`);
      }
      names.add(skill.name);
    }
  }

  function requireLibrary(libraryId) {
    const row = db
      .prepare("SELECT id, local_path, created_at, updated_at FROM skill_libraries WHERE id = ?")
      .get(libraryId);
    if (!row) {
      throw new SkillLibraryDBError(`Skill library ${libraryId} not found.`);
    }
    return mapLibraryRow(row);
  }

  function normalizeDiscoveredSkill(skill) {
    if (!skill.localPath || typeof skill.localPath !== "string") {
      throw new SkillLibraryDBError(`Discovered skill ${skill.name} is missing localPath.`);
    }
    if (skill.description === undefined || skill.description === null) {
      throw new SkillLibraryDBError(
        `Discovered skill ${skill.name} is missing description.`
      );
    }

    return {
      name: skill.name,
      localPath: skill.localPath,
      description: skill.description,
      source: skill.source || null,
      gitSourceUrl: skill.gitSourceUrl || null,
    };
  }

  function loadTagsBySkillIds(skillIds) {
    if (!skillIds.length) {
      return new Map();
    }

    const placeholders = skillIds.map(() => "?").join(", ");
    const rows = db
      .prepare(`
        SELECT st.skill_id, t.name
        FROM skill_tags st
        JOIN tags t ON t.id = st.tag_id
        WHERE st.skill_id IN (${placeholders})
        ORDER BY t.name
      `)
      .all(...skillIds);

    const tagsBySkillId = new Map();
    for (const row of rows) {
      if (!tagsBySkillId.has(row.skill_id)) {
        tagsBySkillId.set(row.skill_id, []);
      }
      tagsBySkillId.get(row.skill_id).push(row.name);
    }
    return tagsBySkillId;
  }

  function listLibraries() {
    const rows = db
      .prepare(`
        SELECT id, local_path, created_at, updated_at
        FROM skill_libraries
        ORDER BY local_path
      `)
      .all();
    return rows.map(mapLibraryRow);
  }

  function setLibrary(localPath) {
    if (!localPath || typeof localPath !== "string") {
      throw new SkillLibraryDBError("localPath is required.");
    }

    const existing = db
      .prepare("SELECT id FROM skill_libraries WHERE local_path = ?")
      .get(localPath);
    const timestamp = now();

    if (existing) {
      db.prepare("UPDATE skill_libraries SET updated_at = ? WHERE id = ?")
        .run(timestamp, existing.id);
    } else {
      db.prepare(`
        INSERT INTO skill_libraries(local_path, created_at, updated_at)
        VALUES (?, ?, ?)
      `).run(localPath, timestamp, timestamp);
    }

    return mapLibraryRow(
      db
      .prepare(`
        SELECT id, local_path, created_at, updated_at
        FROM skill_libraries
        WHERE local_path = ?
      `)
      .get(localPath)
    );
  }

  function getLibrary(libraryId) {
    return requireLibrary(libraryId);
  }

  function deleteOrphanTags() {
    db.prepare(`
      DELETE FROM tags
      WHERE id NOT IN (SELECT DISTINCT tag_id FROM skill_tags)
    `).run();
  }

  function listSkills(libraryId) {
    requireLibrary(libraryId);
    const rows = db
      .prepare(`
        SELECT
          id,
          library_id,
          name,
          local_path,
          description,
          source,
          git_source_url,
          created_at,
          updated_at
        FROM skills
        WHERE library_id = ?
        ORDER BY name
      `)
      .all(libraryId);

    const tagsBySkillId = loadTagsBySkillIds(rows.map((row) => row.id));
    return rows.map((row) => mapSkillRow(row, tagsBySkillId));
  }

  function upsertSkillRows(libraryId, discoveredSkills) {
    const updateTime = now();
    const upsert = db.prepare(`
      INSERT INTO skills(
        library_id,
        name,
        local_path,
        description,
        source,
        git_source_url,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_id, name) DO UPDATE SET
        local_path = excluded.local_path,
        description = excluded.description,
        source = excluded.source,
        git_source_url = excluded.git_source_url,
        updated_at = excluded.updated_at
    `);

    for (const rawSkill of discoveredSkills) {
      const skill = normalizeDiscoveredSkill(rawSkill);
      upsert.run(
        libraryId,
        skill.name,
        skill.localPath,
        skill.description,
        skill.source,
        skill.gitSourceUrl,
        updateTime,
        updateTime
      );
    }
  }

  function replaceLibrarySkills(libraryId, discoveredSkills) {
    assertDiscoveredSkillsArray(discoveredSkills);
    uniqueNames(discoveredSkills);

    inTransaction(() => {
      requireLibrary(libraryId);
      upsertSkillRows(libraryId, discoveredSkills);

      if (discoveredSkills.length) {
        const placeholders = discoveredSkills.map(() => "?").join(", ");
        db.prepare(`
          DELETE FROM skills
          WHERE library_id = ?
          AND name NOT IN (${placeholders})
        `).run(libraryId, ...discoveredSkills.map((skill) => skill.name));
      } else {
        db.prepare("DELETE FROM skills WHERE library_id = ?").run(libraryId);
      }

      deleteOrphanTags();
    });

    return listSkills(libraryId);
  }

  function upsertSkills(libraryId, discoveredSkills) {
    assertDiscoveredSkillsArray(discoveredSkills);
    uniqueNames(discoveredSkills);

    inTransaction(() => {
      requireLibrary(libraryId);
      upsertSkillRows(libraryId, discoveredSkills);
    });

    return listSkills(libraryId);
  }

  function deleteLibrary(libraryId) {
    inTransaction(() => {
      requireLibrary(libraryId);
      db.prepare("DELETE FROM skill_libraries WHERE id = ?").run(libraryId);
      deleteOrphanTags();
    });
  }

  function deleteSkill(skillId) {
    inTransaction(() => {
      db.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
      deleteOrphanTags();
    });
  }

  function listTags() {
    return db.prepare("SELECT id, name FROM tags ORDER BY name").all().map((row) => ({
      id: row.id,
      name: row.name,
    }));
  }

  function findSkillByName(libraryId, skillName) {
    const row = db.prepare(`
      SELECT id, name
      FROM skills
      WHERE library_id = ? AND name = ?
    `).get(libraryId, skillName);

    if (!row) {
      throw new SkillLibraryDBError(`Skill ${skillName} not found in library ${libraryId}.`);
    }

    return row;
  }

  function setSkillTagsById(skillId, tags) {
    const normalizedTags = Array.from(new Set(tags.filter(Boolean)));
    db.prepare("DELETE FROM skill_tags WHERE skill_id = ?").run(skillId);

    const upsertTag = db.prepare(`
      INSERT INTO tags(name) VALUES (?)
      ON CONFLICT(name) DO NOTHING
    `);
    const insertLink = db.prepare(`
      INSERT INTO skill_tags(skill_id, tag_id)
      VALUES (?, ?)
      ON CONFLICT(skill_id, tag_id) DO NOTHING
    `);
    const readTag = db.prepare("SELECT id FROM tags WHERE name = ?");

    for (const tagName of normalizedTags) {
      upsertTag.run(tagName);
      const tagRow = readTag.get(tagName);
      insertLink.run(skillId, tagRow.id);
    }
  }

  function setSkillTags(libraryId, skillName, tags) {
    if (!Array.isArray(tags)) {
      throw new SkillLibraryDBError("tags must be an array.");
    }

    inTransaction(() => {
      requireLibrary(libraryId);
      const skill = findSkillByName(libraryId, skillName);
      setSkillTagsById(skill.id, tags);
      deleteOrphanTags();
    });

    return findSkillByName(libraryId, skillName);
  }

  function importTagsForExistingSkills(libraryId, skillTagsByName) {
    if (!skillTagsByName || typeof skillTagsByName !== "object" || Array.isArray(skillTagsByName)) {
      throw new SkillLibraryDBError("skillTagsByName must be an object.");
    }

    const updatedSkillNames = [];
    const missingSkillNames = [];
    const importedTags = new Set();

    inTransaction(() => {
      requireLibrary(libraryId);
      const skills = db.prepare(`
        SELECT id, name
        FROM skills
        WHERE library_id = ?
      `).all(libraryId);
      const skillIdsByName = new Map(skills.map((skill) => [skill.name, skill.id]));

      for (const [skillName, rawTags] of Object.entries(skillTagsByName)) {
        const skillId = skillIdsByName.get(skillName);
        if (!skillId) {
          missingSkillNames.push(skillName);
          continue;
        }
        const tags = Array.isArray(rawTags) ? rawTags : [];
        for (const tag of tags) {
          importedTags.add(tag);
        }
        setSkillTagsById(skillId, tags);
        updatedSkillNames.push(skillName);
      }

      deleteOrphanTags();
    });

    return {
      libraryId,
      updatedSkillNames: updatedSkillNames.sort((left, right) => left.localeCompare(right)),
      uniqueTagsImported: Array.from(importedTags).sort((left, right) =>
        left.localeCompare(right)
      ),
      missingSkillNames: missingSkillNames.sort((left, right) => left.localeCompare(right)),
    };
  }

  return {
    close,
    deleteLibrary,
    deleteSkill,
    getLibrary,
    importTagsForExistingSkills,
    initialize,
    listLibraries,
    listSkills,
    listTags,
    replaceLibrarySkills,
    setLibrary,
    setSkillTags,
    upsertSkills,
  };
}

module.exports = {
  SkillLibraryDBError,
  createDBAdapter,
};
