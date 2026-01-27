## Deploy to Production

### Summary
<!-- このデプロイで何が本番環境に反映されるか -->


### Included Changes
<!-- main ブランチの変更内容。`git log production..main --oneline` を貼り付け -->

```
```

### Risk Assessment
<!-- 該当するものにチェック -->

- [ ] Low - UI/ドキュメントのみ、影響範囲が限定的
- [ ] Medium - 既存機能の改善、新機能追加
- [ ] High - 破壊的変更、データ構造変更、インフラ変更

### Affected Services
<!-- 影響を受けるサービスにチェック -->

- [ ] Frontend
- [ ] Backend API
- [ ] Cloudflare Workers
- [ ] KV Namespace

### Pre-deploy Checklist

- [ ] CI(lint, build, test, e2e)が通っている
- [ ] ローカル環境で動作確認済み
- [ ] 新しいCloudflareリソースは事前作成済み(該当する場合)

### Post-deploy Verification

- [ ] フロントエンド - トップページ表示
- [ ] バックエンドAPI - ヘルスチェック 200 OK
- [ ] 主要機能の動作確認(該当する場合)

### Rollback Plan
<!-- 問題発生時の対応。通常は「production ブランチを前のコミットに戻して再デプロイ」 -->

production ブランチを前のコミットに戻して再デプロイ

### Notes
<!-- 特記事項、監視すべきメトリクス、段階的ロールアウトの計画など -->

