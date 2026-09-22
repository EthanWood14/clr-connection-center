/** Expand SQLite's currency constraint atomically while retaining every receipt. */
export function migrateShopTextCurrency(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS tv_car_shop_loadouts (
    org_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    upgrades_json TEXT NOT NULL, PRIMARY KEY (org_id, user_id)
  )`);
  for (const table of ["tv_car_shop_purchases", "tv_car_shop_consumable_purchases"]) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!row?.sql || row.sql.includes("'texts'")) continue;
    db.transaction(() => {
      const next = `${table}_texts_v2`;
      const ddl = row.sql.replace(table, next).replace("'calltools_seconds'", "'calltools_seconds','texts'");
      db.exec(ddl);
      db.exec(`INSERT INTO ${next} SELECT * FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${next} RENAME TO ${table}`);
      if (table.endsWith("consumable_purchases")) db.exec(`CREATE INDEX IF NOT EXISTS idx_tv_car_shop_consumables_owner ON ${table}(org_id,user_id,item_id)`);
    })();
  }
}
