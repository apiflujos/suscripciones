-- Add AI credential providers
ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'OPENAI';
ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'DEEPSEEK';
