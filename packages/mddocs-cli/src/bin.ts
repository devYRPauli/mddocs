#!/usr/bin/env node
import { buildProgram } from './cli'

buildProgram().parseAsync(process.argv)
