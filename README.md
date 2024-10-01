
Typescript: protocol buffer についてのメモ https://escape.tech/blog/using-protobuf-typescript

使っている protocol buffer のライブラリ https://www.npmjs.com/package/@bufbuild/protoc-gen-es

## テストケースで書く必要があるけど特に忘れそうなケース
* 再接続後には状態が一新されるが、一部の状態は引き継がれる
  * NextAt
  * BackwardUri
  * 再接続前に取得した最後のコメントまでスキップされる
  * 最後に取得したコメントが最後のエントリー内でない場合の再接続
    （実環境では最後のエントリでない場合でも"previous"に入ってる場合が多いので気づきにくい）
  * 過去メッセージを取得した時にlastMetaを更新し忘れている可能性
    * 過去メッセージを取得してすぐ切断→再接続時に同じコメントを取得してしまう