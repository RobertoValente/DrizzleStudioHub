import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    out: './drizzle',
    dialect: 'mysql',
    dbCredentials: {
        url: 'mysql://user:password@host:3306/database',
    },
});
