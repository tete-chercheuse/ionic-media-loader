import { ModuleWithProviders, NgModule } from '@angular/core';
import { CommonModule } from "@angular/common";
import { IonicModule } from '@ionic/angular';

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
