import { Injectable } from '@angular/core';

@Injectable()
export class MediaLoaderConfig {

  debugMode = true;

  concurrency = 5;

  maxCacheSize = -1;

  maxCacheAge = -1;

  fallbackFileNameCachedExtension = '.jpg';

  imageReturnType: 'base64' | 'uri' = 'uri';

  fileTransferOptions: any = {
    trustAllHosts: false
  };

  private _cacheDirectoryName: string = 'ionic-media-loader';
}
