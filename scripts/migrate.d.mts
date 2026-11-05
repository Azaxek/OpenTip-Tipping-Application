export function runMigrations(connectionString: string, log?: (msg: string) => void): Promise<void>;
export function assertUtf8(client: { query(sql: string): Promise<{ rows: { server_encoding?: string }[] }> }): Promise<void>;
