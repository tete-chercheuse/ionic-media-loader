import { ModuleWithProviders, NgModule } from '@angular/core';
import { CommonModule } from "@angular/common";
import { IonicModule } from '@ionic/angular';
import { File } from "@ionic-native/file/ngx";
import { HTTP } from "@ionic-native/http/ngx";

import { IonicMediaLoaderDirective } from './directives/media-loader.directive';
import { IonicMediaLoaderService } from "./services/media-loader.service";
import { IONIC_MEDIA_LOADER_CONFIG, IonicMediaLoaderConfig, IonicMediaLoaderConfigProvider, IonicMediaLoaderModuleOptions } from "./media-loader.models";

@NgModule({
  declarations: [
    IonicMediaLoaderDirective,
  ],
  imports: [
    CommonModule,
    IonicModule,
  ],
  providers: [
    IonicMediaLoaderService,
    File,
    HTTP,
  ],
  exports: [
    IonicMediaLoaderDirective,
  ],
})
export class IonicMediaLoaderModule {

  public static forRoot(config?: IonicMediaLoaderModuleOptions): ModuleWithProviders {
    return {
      ngModule: IonicMediaLoaderModule,
      providers: [
        {
          provide: IONIC_MEDIA_LOADER_CONFIG,
          useValue: config
        },
        {
          provide: IonicMediaLoaderConfig,
          useFactory: IonicMediaLoaderConfigProvider,
          deps: [IONIC_MEDIA_LOADER_CONFIG]
        }
      ]
    };
  }
}
