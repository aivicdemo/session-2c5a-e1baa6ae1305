// AIVIC Backend Configuration
// AIVIC_APP_URL 環境変数が設定されている場合は自動セットされます
// 未設定の場合: REPLACE_WITH_API_URL を AIVIC アプリの URL（例: https://your-app.amplifyapp.com）に書き換えてください

window.AIVIC_API_URL = "REPLACE_WITH_API_URL";
window.AIVIC_TABLES = {
  "修理案件": 0,
  "顧客": 1,
  "修理案件状態遷移履歴": 2,
  "見積情報": 3,
  "部品": 4,
  "部品入荷予定": 5,
  "顧客連絡履歴": 6,
  "ログインユーザー": 7,
  "ユーザー権限": 8,
  "状態マスタ": 9,
  "見積金額段階設定": 10,
  "自動催促設定": 11
};
