import { ModuleWithProviders, NgModule } from '@angular/core';
import { CommonModule } from "@angular/common";
import { IonicModule } from '@ionic/angular';
import { File } from "@ionic-native/file/ngx";
import { HTTP } from "@ionic-native/http/ngx";

import { IonicMediaLoaderDirective } from './directives/media-loader.directive';
import { IonicMediaLoaderService } from "./services/media-loader.service";
import { IonicMediaLoaderConfig } from "./media-loader.config";

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

  public static config(config: IonicMediaLoaderConfig) {
    IonicMediaLoaderService.config = { ...IonicMediaLoaderService.config, ...config };
  }

  public static forRoot(): ModuleWithProviders {
    return {
      ngModule: IonicMediaLoaderModule,
    };
  }
}
