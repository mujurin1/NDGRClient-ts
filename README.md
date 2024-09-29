
Typescript: protocol buffer についてのメモ https://escape.tech/blog/using-protobuf-typescript

使っている protocol buffer のライブラリ https://www.npmjs.com/package/@bufbuild/protoc-gen-es

## テストケースで書く必要があるけど特に忘れそうなケース
* 再接続後には状態が一新されるが、一部の状態は引き継がれる
  * NextAt
  * BackwardUri
  * 再接続前に取得した最後のコメントまでスキップされる
