import { ModuleWithProviders, NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { IonicMediaLoaderDirective } from './directives/media-loader.directive';
import { CommonModule } from "@angular/common";
import { File } from '@ionic-native/file/ngx';
import { FileTransfer } from '@ionic-native/file-transfer/ngx';


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
        File,
        FileTransfer,
      ]
    };
  }
}
