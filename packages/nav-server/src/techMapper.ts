/* ============================================================
   TECH MAPPER — Maps dependencies to documentation URLs
   Parses package.json, docker-compose.yml, Dockerfile
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TechStackItem {
  name: string;
  version: string | null;
  category: 'framework' | 'database' | 'devtool' | 'runtime' | 'infra';
  docUrl: string;
}

// ---- Tech Dictionary (~50 entries) ----

const TECH_MAP: Record<string, { category: TechStackItem['category']; docUrl: string; displayName?: string }> = {
  // Frameworks
  'react': { category: 'framework', docUrl: 'https://react.dev' },
  'react-dom': { category: 'framework', docUrl: 'https://react.dev/reference/react-dom' },
  'next': { category: 'framework', docUrl: 'https://nextjs.org/docs' },
  'vue': { category: 'framework', docUrl: 'https://vuejs.org/guide' },
  'nuxt': { category: 'framework', docUrl: 'https://nuxt.com/docs' },
  'svelte': { category: 'framework', docUrl: 'https://svelte.dev/docs' },
  'angular': { category: 'framework', docUrl: 'https://angular.dev' },
  '@angular/core': { category: 'framework', docUrl: 'https://angular.dev', displayName: 'Angular' },
  '@nestjs/core': { category: 'framework', docUrl: 'https://docs.nestjs.com', displayName: 'NestJS' },
  '@nestjs/common': { category: 'framework', docUrl: 'https://docs.nestjs.com', displayName: 'NestJS' },
  'express': { category: 'framework', docUrl: 'https://expressjs.com' },
  'fastify': { category: 'framework', docUrl: 'https://fastify.dev/docs' },
  'hono': { category: 'framework', docUrl: 'https://hono.dev/docs' },
  'remix': { category: 'framework', docUrl: 'https://remix.run/docs' },
  'astro': { category: 'framework', docUrl: 'https://docs.astro.build' },
  'gatsby': { category: 'framework', docUrl: 'https://www.gatsbyjs.com/docs' },
  'django': { category: 'framework', docUrl: 'https://docs.djangoproject.com' },
  'flask': { category: 'framework', docUrl: 'https://flask.palletsprojects.com' },
  'fastapi': { category: 'framework', docUrl: 'https://fastapi.tiangolo.com' },
  'spring-boot': { category: 'framework', docUrl: 'https://docs.spring.io/spring-boot' },

  // Databases & ORMs
  'prisma': { category: 'database', docUrl: 'https://www.prisma.io/docs' },
  '@prisma/client': { category: 'database', docUrl: 'https://www.prisma.io/docs', displayName: 'Prisma' },
  'drizzle-orm': { category: 'database', docUrl: 'https://orm.drizzle.team/docs' },
  'typeorm': { category: 'database', docUrl: 'https://typeorm.io' },
  'mongoose': { category: 'database', docUrl: 'https://mongoosejs.com/docs' },
  'sequelize': { category: 'database', docUrl: 'https://sequelize.org/docs' },
  'knex': { category: 'database', docUrl: 'https://knexjs.org/guide' },
  'redis': { category: 'database', docUrl: 'https://redis.io/docs' },
  'ioredis': { category: 'database', docUrl: 'https://redis.io/docs', displayName: 'Redis' },
  'pg': { category: 'database', docUrl: 'https://www.postgresql.org/docs', displayName: 'PostgreSQL' },
  'mysql2': { category: 'database', docUrl: 'https://dev.mysql.com/doc', displayName: 'MySQL' },

  // DevTools
  'typescript': { category: 'devtool', docUrl: 'https://www.typescriptlang.org/docs' },
  'vite': { category: 'devtool', docUrl: 'https://vite.dev/guide' },
  'webpack': { category: 'devtool', docUrl: 'https://webpack.js.org/concepts' },
  'esbuild': { category: 'devtool', docUrl: 'https://esbuild.github.io' },
  'jest': { category: 'devtool', docUrl: 'https://jestjs.io/docs/getting-started' },
  'vitest': { category: 'devtool', docUrl: 'https://vitest.dev/guide' },
  'playwright': { category: 'devtool', docUrl: 'https://playwright.dev/docs/intro' },
  'cypress': { category: 'devtool', docUrl: 'https://docs.cypress.io' },
  'eslint': { category: 'devtool', docUrl: 'https://eslint.org/docs/latest' },
  'prettier': { category: 'devtool', docUrl: 'https://prettier.io/docs' },
  'tailwindcss': { category: 'devtool', docUrl: 'https://tailwindcss.com/docs' },
  'storybook': { category: 'devtool', docUrl: 'https://storybook.js.org/docs' },

  // Runtime & Infra
  'docker': { category: 'infra', docUrl: 'https://docs.docker.com' },
  'docker-compose': { category: 'infra', docUrl: 'https://docs.docker.com/compose' },
  'nginx': { category: 'infra', docUrl: 'https://nginx.org/en/docs' },
  'rabbitmq': { category: 'infra', docUrl: 'https://www.rabbitmq.com/docs' },
  'amqplib': { category: 'infra', docUrl: 'https://www.rabbitmq.com/docs', displayName: 'RabbitMQ' },
  'kafka': { category: 'infra', docUrl: 'https://kafka.apache.org/documentation' },
  'kafkajs': { category: 'infra', docUrl: 'https://kafka.apache.org/documentation', displayName: 'Kafka' },
  '@reduxjs/toolkit': { category: 'framework', docUrl: 'https://redux-toolkit.js.org', displayName: 'Redux Toolkit' },
  'zustand': { category: 'framework', docUrl: 'https://zustand.docs.pmnd.rs' },
  'graphql': { category: 'framework', docUrl: 'https://graphql.org/learn' },
  '@apollo/client': { category: 'framework', docUrl: 'https://www.apollographql.com/docs', displayName: 'Apollo GraphQL' },
};

// Docker Compose service → tech mapping
const DOCKER_SERVICE_MAP: Record<string, { name: string; category: TechStackItem['category']; docUrl: string }> = {
  postgres: { name: 'PostgreSQL', category: 'database', docUrl: 'https://www.postgresql.org/docs' },
  postgresql: { name: 'PostgreSQL', category: 'database', docUrl: 'https://www.postgresql.org/docs' },
  mysql: { name: 'MySQL', category: 'database', docUrl: 'https://dev.mysql.com/doc' },
  mariadb: { name: 'MariaDB', category: 'database', docUrl: 'https://mariadb.com/kb' },
  mongo: { name: 'MongoDB', category: 'database', docUrl: 'https://www.mongodb.com/docs' },
  mongodb: { name: 'MongoDB', category: 'database', docUrl: 'https://www.mongodb.com/docs' },
  redis: { name: 'Redis', category: 'database', docUrl: 'https://redis.io/docs' },
  rabbitmq: { name: 'RabbitMQ', category: 'infra', docUrl: 'https://www.rabbitmq.com/docs' },
  kafka: { name: 'Kafka', category: 'infra', docUrl: 'https://kafka.apache.org/documentation' },
  elasticsearch: { name: 'Elasticsearch', category: 'database', docUrl: 'https://www.elastic.co/docs' },
  nginx: { name: 'Nginx', category: 'infra', docUrl: 'https://nginx.org/en/docs' },
  traefik: { name: 'Traefik', category: 'infra', docUrl: 'https://doc.traefik.io/traefik' },
  minio: { name: 'MinIO', category: 'infra', docUrl: 'https://min.io/docs' },
  qdrant: { name: 'Qdrant', category: 'database', docUrl: 'https://qdrant.tech/documentation' },
  grafana: { name: 'Grafana', category: 'devtool', docUrl: 'https://grafana.com/docs' },
  prometheus: { name: 'Prometheus', category: 'devtool', docUrl: 'https://prometheus.io/docs' },
};

/**
 * Parse package.json and extract tech stack.
 */
async function parsePackageJson(rootPath: string): Promise<TechStackItem[]> {
  const items: TechStackItem[] = [];
  const seen = new Set<string>();

  try {
    const raw = await readFile(join(rootPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const [dep, ver] of Object.entries(allDeps)) {
      const key = dep.toLowerCase();
      const match = TECH_MAP[key];
      if (match) {
        const displayName = match.displayName ?? dep;
        if (seen.has(displayName)) continue;
        seen.add(displayName);

        items.push({
          name: displayName,
          version: typeof ver === 'string' ? ver.replace(/^[\^~>=<]/, '') : null,
          category: match.category,
          docUrl: match.docUrl,
        });
      }
    }
  } catch {
    // No package.json or invalid
  }

  return items;
}

/**
 * Parse docker-compose.yml using regex (no YAML parser).
 */
async function parseDockerCompose(rootPath: string): Promise<TechStackItem[]> {
  const items: TechStackItem[] = [];
  const filenames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

  for (const filename of filenames) {
    try {
      const raw = await readFile(join(rootPath, filename), 'utf-8');

      // Match image: lines
      const imageMatches = raw.matchAll(/image:\s*['"]?([^'"\s]+)/g);
      for (const m of imageMatches) {
        const imageName = m[1].split(':')[0].split('/').pop() ?? '';
        const key = imageName.toLowerCase();
        const mapped = DOCKER_SERVICE_MAP[key];
        if (mapped && !items.some(i => i.name === mapped.name)) {
          items.push({ ...mapped, version: m[1].split(':')[1] ?? null });
        }
      }

      // Match service names under services:
      const serviceMatches = raw.matchAll(/^\s{2}(\w[\w-]*):\s*$/gm);
      for (const m of serviceMatches) {
        const svc = m[1].toLowerCase();
        const mapped = DOCKER_SERVICE_MAP[svc];
        if (mapped && !items.some(i => i.name === mapped.name)) {
          items.push({ ...mapped, version: null });
        }
      }

      break; // Found a compose file, stop looking
    } catch {
      continue;
    }
  }

  return items;
}

/**
 * Check for Dockerfile presence.
 */
async function checkDockerfile(rootPath: string): Promise<TechStackItem[]> {
  try {
    await readFile(join(rootPath, 'Dockerfile'), 'utf-8');
    return [{
      name: 'Docker',
      version: null,
      category: 'infra',
      docUrl: 'https://docs.docker.com',
    }];
  } catch {
    return [];
  }
}

/**
 * Analyze a project directory and return its tech stack.
 */
export async function detectTechStack(rootPath: string): Promise<TechStackItem[]> {
  const [pkgItems, composeItems, dockerItems] = await Promise.all([
    parsePackageJson(rootPath),
    parseDockerCompose(rootPath),
    checkDockerfile(rootPath),
  ]);

  // Deduplicate by name
  const seen = new Set<string>();
  const result: TechStackItem[] = [];

  for (const item of [...pkgItems, ...composeItems, ...dockerItems]) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      result.push(item);
    }
  }

  // Sort: framework → database → devtool → runtime → infra
  const order: Record<string, number> = { framework: 0, database: 1, devtool: 2, runtime: 3, infra: 4 };
  result.sort((a, b) => (order[a.category] ?? 5) - (order[b.category] ?? 5));

  return result;
}
