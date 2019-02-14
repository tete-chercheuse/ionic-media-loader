import { ModuleWithProviders, NgModule } from '@angular/core';
import { CommonModule } from "@angular/common";
import { IonicModule } from '@ionic/angular';
import { File } from '@ionic-native/file/ngx';
import { FileTransfer } from '@ionic-native/file-transfer/ngx';

import { IonicMediaLoaderDirective } from './directives/media-loader.directive';
import { IonicMediaLoaderService } from "./services/media-loader.service";


@NgModule({
  declarations: [
    IonicMediaLoaderDirective,
  ],
  imports: [
    CommonModule,
    IonicModule,
  ],
  exports: [
    IonicMediaLoaderDirective,
  ],
})
export class IonicMediaLoaderModule {
  static forRoot(): ModuleWithProviders {
    return {
      ngModule: IonicMediaLoaderModule,
      providers: [
        IonicMediaLoaderService,
        File,
        FileTransfer,
      ]
    };
  }
}
