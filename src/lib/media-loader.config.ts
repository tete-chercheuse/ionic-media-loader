import { HttpHeaders } from '@angular/common/http';

export class IonicMediaLoaderConfig {
  debugMode?: boolean;
  concurrency?: number;
  maxCacheSize?: number;
  maxCacheAge?: number;
  httpHeaders?: HttpHeaders;
  fallbackFileNameCachedExtension?: string;
  cacheDirectoryName?: string;
}
