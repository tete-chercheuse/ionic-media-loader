import { HttpHeaders } from '@angular/common/http';
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

export interface IonicMediaLoaderConfig {
  debugMode?: boolean;
  concurrency?: number;
  maxCacheSize?: number;
  maxCacheAge?: number;
  httpHeaders?: HttpHeaders;
  fallbackFileNameCachedExtension?: string;
  cacheDirectoryName?: string;
  imageReturnType?: 'uri' | 'base64';
}

export const defaultConfig: IonicMediaLoaderConfig = {
  debugMode: false,
  concurrency: 5,
  maxCacheSize: -1,
  maxCacheAge: -1,
  fallbackFileNameCachedExtension: '.jpg',
  cacheDirectoryName: 'ionic-media-loader',
  imageReturnType: 'uri'
};

export const IONIC_MEDIA_LOADER_CONFIG = new InjectionToken<IonicMediaLoaderConfig>('config')
