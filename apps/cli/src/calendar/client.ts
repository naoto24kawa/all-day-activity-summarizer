/**
 * Google Calendar API Client
 *
 * OAuth 2.0 Desktop Application Flow を使用した認証
 * - 初回認証時にブラウザでアクセス許可が必要
 * - トークンは ~/.adas/calendar-token.json に保存
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import consola from "consola";
import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { AdasConfig } from "../config.js";

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

export interface CalendarClientConfig {
  credentialsPath: string;
  tokenPath: string;
}

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus: string; // "needsAction" | "declined" | "tentative" | "accepted"
  self?: boolean;
  organizer?: boolean;
}

export interface CalendarEventOrganizer {
  email: string;
  displayName?: string;
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  attendees?: CalendarEventAttendee[];
  organizer?: CalendarEventOrganizer;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
    }>;
  };
  status: string; // "confirmed" | "tentative" | "cancelled"
}

export interface ListEventsResponse {
  items: CalendarEvent[];
  nextPageToken?: string;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

export interface CalendarListResponse {
  items: CalendarListEntry[];
  nextPageToken?: string;
}

export class GoogleCalendarClient {
  private config: CalendarClientConfig;
  private oauth2Client: OAuth2Client | null = null;

  constructor(config: CalendarClientConfig) {
    this.config = config;
  }

  /**
   * 認証済みの OAuth2 クライアントを取得
   * トークンファイルが存在しない場合は新規認証フローを実行
   */
  async getAuthClient(): Promise<OAuth2Client> {
    if (this.oauth2Client) {
      return this.oauth2Client;
    }

    // credentials.json を読み込み
    if (!existsSync(this.config.credentialsPath)) {
      throw new Error(
        `Google Calendar credentials not found at ${this.config.credentialsPath}. ` +
          "Please download credentials.json from Google Cloud Console and place it there.",
      );
    }

    const credentials = JSON.parse(readFileSync(this.config.credentialsPath, "utf-8"));
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    // Desktop アプリケーション用の redirect_uri を使用
    const redirectUri = redirect_uris?.[0] || "http://localhost:3456";

    this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    // 既存のトークンを読み込み
    if (existsSync(this.config.tokenPath)) {
      const token = JSON.parse(readFileSync(this.config.tokenPath, "utf-8"));
      this.oauth2Client.setCredentials(token);

      // トークンの更新イベントを監視して保存
      this.oauth2Client.on("tokens", (tokens) => {
        const currentToken = JSON.parse(readFileSync(this.config.tokenPath, "utf-8"));
        const updatedToken = { ...currentToken, ...tokens };
        writeFileSync(this.config.tokenPath, JSON.stringify(updatedToken, null, 2));
        consola.debug("Calendar: Token refreshed and saved");
      });

      return this.oauth2Client;
    }

    // 新規認証フローを実行
    await this.authorizeNewToken(this.oauth2Client, redirectUri);
    return this.oauth2Client;
  }

  /**
   * 新規認証フローを実行
   * ローカルサーバーを立ち上げて認証コードを受け取る
   */
  private async authorizeNewToken(oauth2Client: OAuth2Client, redirectUri: string): Promise<void> {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent", // リフレッシュトークンを確実に取得
    });

    consola.info("Authorize this app by visiting this URL:");
    consola.info(authUrl);

    // ローカルサーバーで認証コードを受け取る
    const code = await this.waitForAuthCode(redirectUri);

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // トークンを保存
    writeFileSync(this.config.tokenPath, JSON.stringify(tokens, null, 2));
    consola.success("Calendar: Token stored to", this.config.tokenPath);
  }

  /**
   * ローカルサーバーで認証コードを待機
   */
  private waitForAuthCode(redirectUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(redirectUri);
      const port = Number.parseInt(url.port) || 3456;

      const server = createServer((req, res) => {
        const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
        const code = reqUrl.searchParams.get("code");
        const error = reqUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>認証エラー</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`Authorization error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>認証成功</h1><p>このウィンドウを閉じて、ターミナルに戻ってください。</p>");
          server.close();
          resolve(code);
          return;
        }

        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>無効なリクエスト</h1>");
      });

      server.listen(port, () => {
        consola.info(`Waiting for authorization on port ${port}...`);
      });

      // 5分でタイムアウト
      setTimeout(
        () => {
          server.close();
          reject(new Error("Authorization timeout"));
        },
        5 * 60 * 1000,
      );
    });
  }

  /**
   * 指定期間のイベント一覧を取得
   */
  async listEvents(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    pageToken?: string,
  ): Promise<ListEventsResponse> {
    const auth = await this.getAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true, // 繰り返しイベントを展開
      orderBy: "startTime",
      maxResults: 100,
      pageToken,
    });

    return {
      items: (response.data.items || []) as CalendarEvent[],
      nextPageToken: response.data.nextPageToken || undefined,
    };
  }

  /**
   * カレンダー一覧を取得
   */
  async listCalendars(pageToken?: string): Promise<CalendarListResponse> {
    const auth = await this.getAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.calendarList.list({
      maxResults: 100,
      pageToken,
    });

    return {
      items: (response.data.items || []) as CalendarListEntry[],
      nextPageToken: response.data.nextPageToken || undefined,
    };
  }

  /**
   * トークンが有効かチェック
   */
  async verifyToken(): Promise<boolean> {
    try {
      const auth = await this.getAuthClient();
      // カレンダー一覧を取得して認証を確認
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.calendarList.list({ maxResults: 1 });
      return true;
    } catch (error) {
      consola.error("Calendar: Token verification failed:", error);
      return false;
    }
  }

  /**
   * 認証をクリア (再認証用)
   */
  clearAuth(): void {
    this.oauth2Client = null;
  }
}

/**
 * GoogleCalendarClient のシングルトンインスタンスを作成
 */
export function createCalendarClient(config: AdasConfig): GoogleCalendarClient {
  return new GoogleCalendarClient({
    credentialsPath: config.calendar.credentialsPath,
    tokenPath: config.calendar.tokenPath,
  });
}
