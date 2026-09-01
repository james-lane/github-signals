#!/usr/bin/env node
import { rm } from 'node:fs/promises';

const buildDirectory = new URL('../dist/', import.meta.url);
await rm(buildDirectory, { recursive: true, force: true });
