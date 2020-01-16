import { InjectionToken } from '@angular/core'

export interface IndexItem {
  name: string;
  modificationTime: Date;
  size: number;
}

export interface QueueItem {
  mediaUrl: string;
  resolve: Function;
  reject: Function;
}

export interface IonicMediaLoaderModuleOptions {
  debugMode?: boolean,
  concurrency?: number,
  maxCacheSize?: number,
  maxCacheAge?: number,
  fallbackFileNameCachedExtension?: string,
  cacheDirectoryName?: string,
  imageReturnType?: 'uri' | 'base64'
};

export class IonicMediaLoaderConfig {
  debugMode: boolean = false;
  concurrency: number = 5;
  maxCacheSize: number = -1;
  maxCacheAge: number = -1;
  fallbackFileNameCachedExtension: string = '.jpg';
  cacheDirectoryName: string = 'ionic-media-loader';
  imageReturnType: 'uri' | 'base64' = 'uri'
};

export const IONIC_MEDIA_LOADER_CONFIG = new InjectionToken<IonicMediaLoaderModuleOptions>('IonicMediaLoaderModuleOptions');

export function IonicMediaLoaderConfigProvider(options?: IonicMediaLoaderModuleOptions): IonicMediaLoaderConfig {

  let config = new IonicMediaLoaderConfig();

  if(options) {
    config.debugMode = options.debugMode || config.debugMode;
    config.concurrency = options.concurrency || config.concurrency;
    config.maxCacheSize = options.maxCacheSize || config.maxCacheSize;
    config.maxCacheAge = options.maxCacheAge || config.maxCacheAge;
    config.fallbackFileNameCachedExtension = options.fallbackFileNameCachedExtension || config.fallbackFileNameCachedExtension;
    config.cacheDirectoryName = options.cacheDirectoryName || config.cacheDirectoryName;
    config.imageReturnType = options.imageReturnType || config.imageReturnType;
  }

  return config;

}
