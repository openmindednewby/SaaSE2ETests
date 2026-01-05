import axios, { AxiosInstance } from 'axios';

interface TokenResponse {
  accessToken: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  expiresIn: number;
  userInfo: {
    sub: string;
    email: string;
    name: string;
    roles: string[];
  } | null;
  errorMessage?: string;
  errorCode?: string;
}

interface LogoutResponse {
  success: boolean;
  errorMessage?: string;
}

export class AuthHelper {
  private apiClient: AxiosInstance;
  private tokens: TokenResponse | null = null;

  constructor(baseUrl?: string) {
    this.apiClient = axios.create({
      baseURL: baseUrl || process.env.IDENTITY_API_URL || 'http://localhost:5002',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Login via API using username and password
   */
  async loginViaAPI(username: string, password: string, tenantId?: string): Promise<TokenResponse> {
    const response = await this.apiClient.post<TokenResponse>('/auth/login', {
      method: 0, // AuthMethod.UsernamePassword
      username,
      password,
      tenantId,
    });

    if (!response.data.accessToken) {
      throw new Error(`Login failed: ${response.data.errorMessage || 'Unknown error'}`);
    }

    this.tokens = response.data;
    return this.tokens;
  }

  /**
   * Refresh tokens using refresh token
   */
  async refreshTokens(): Promise<TokenResponse> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.apiClient.post<TokenResponse>('/auth/refresh', {
      refreshToken: this.tokens.refreshToken,
    });

    if (!response.data.accessToken) {
      throw new Error(`Token refresh failed: ${response.data.errorMessage || 'Unknown error'}`);
    }

    this.tokens = response.data;
    return this.tokens;
  }

  /**
   * Logout and revoke tokens
   */
  async logout(): Promise<LogoutResponse> {
    if (!this.tokens?.accessToken) {
      return { success: true };
    }

    const response = await this.apiClient.post<LogoutResponse>('/auth/logout', {
      token: this.tokens.accessToken,
    });

    this.tokens = null;
    return response.data;
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    return this.tokens?.refreshToken ?? null;
  }

  /**
   * Get current tokens
   */
  getTokens(): TokenResponse | null {
    return this.tokens;
  }

  /**
   * Create an authenticated axios instance for API calls
   */
  createAuthenticatedClient(baseURL: string): AxiosInstance {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    return axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });
  }
}
