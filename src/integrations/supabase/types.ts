export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          gas_loader_enabled: boolean
          id: string
          mobile_recharge_enabled: boolean
          notice_message: string | null
          updated_at: string
        }
        Insert: {
          gas_loader_enabled?: boolean
          id?: string
          mobile_recharge_enabled?: boolean
          notice_message?: string | null
          updated_at?: string
        }
        Update: {
          gas_loader_enabled?: boolean
          id?: string
          mobile_recharge_enabled?: boolean
          notice_message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      free_gas_usage: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          id: string
          ip_address: string
          status: string
          tx_hash: string | null
          used_on: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          id?: string
          ip_address: string
          status?: string
          tx_hash?: string | null
          used_on?: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          id?: string
          ip_address?: string
          status?: string
          tx_hash?: string | null
          used_on?: string
          wallet_address?: string
        }
        Relationships: []
      }
      gas_load_history: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          proxy_ip: string | null
          status: string
          tx_hash: string | null
          wallet_address: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          proxy_ip?: string | null
          status: string
          tx_hash?: string | null
          wallet_address: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          proxy_ip?: string | null
          status?: string
          tx_hash?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      gas_load_jobs: {
        Row: {
          batch_name: string
          created_at: string
          delay_ms: number
          done: number
          failed: number
          finished_at: string | null
          id: string
          max_retries: number
          retry_round: number
          status: string
          submitted_by_wallet: string | null
          total: number
          updated_at: string
        }
        Insert: {
          batch_name?: string
          created_at?: string
          delay_ms?: number
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          max_retries?: number
          retry_round?: number
          status?: string
          submitted_by_wallet?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          batch_name?: string
          created_at?: string
          delay_ms?: number
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          max_retries?: number
          retry_round?: number
          status?: string
          submitted_by_wallet?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      gas_load_queue: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          processed_at: string | null
          proxy_ip: string | null
          status: string
          tx_hash: string | null
          updated_at: string
          wallet_address: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          processed_at?: string | null
          proxy_ip?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          processed_at?: string | null
          proxy_ip?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "gas_load_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "gas_load_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      locked_wallets: {
        Row: {
          added_at: string
          id: string
          membership_id: string
          wallet_address: string
        }
        Insert: {
          added_at?: string
          id?: string
          membership_id: string
          wallet_address: string
        }
        Update: {
          added_at?: string
          id?: string
          membership_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "locked_wallets_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "user_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_payments: {
        Row: {
          admin_note: string | null
          amount_usdt: number | null
          bsc_block_number: number | null
          bsc_confirmations: number | null
          created_at: string
          expected_amount: number
          from_address: string | null
          id: string
          package_id: string
          status: string
          tx_hash: string
          updated_at: string
          user_wallet: string
          verification_method: string | null
        }
        Insert: {
          admin_note?: string | null
          amount_usdt?: number | null
          bsc_block_number?: number | null
          bsc_confirmations?: number | null
          created_at?: string
          expected_amount: number
          from_address?: string | null
          id?: string
          package_id: string
          status?: string
          tx_hash: string
          updated_at?: string
          user_wallet: string
          verification_method?: string | null
        }
        Update: {
          admin_note?: string | null
          amount_usdt?: number | null
          bsc_block_number?: number | null
          bsc_confirmations?: number | null
          created_at?: string
          expected_amount?: number
          from_address?: string | null
          id?: string
          package_id?: string
          status?: string
          tx_hash?: string
          updated_at?: string
          user_wallet?: string
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vip_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      recharge_requests: {
        Row: {
          admin_note: string | null
          amount_bdt: number
          amount_gd: string
          created_at: string
          id: string
          network: string
          operator: string
          phone_number: string
          status: string
          tx_hash: string | null
          updated_at: string
          wallet_address: string
        }
        Insert: {
          admin_note?: string | null
          amount_bdt?: number
          amount_gd?: string
          created_at?: string
          id?: string
          network?: string
          operator: string
          phone_number: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address: string
        }
        Update: {
          admin_note?: string | null
          amount_bdt?: number
          amount_gd?: string
          created_at?: string
          id?: string
          network?: string
          operator?: string
          phone_number?: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      user_memberships: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          package_id: string
          payment_id: string | null
          starts_at: string | null
          status: string
          updated_at: string
          user_wallet: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id: string
          payment_id?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
          user_wallet: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string
          payment_id?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
          user_wallet?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_memberships_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vip_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_packages: {
        Row: {
          badge: string | null
          created_at: string
          display_order: number
          duration_days: number
          id: string
          name: string
          price_usdt: number
          wallet_slots: number
        }
        Insert: {
          badge?: string | null
          created_at?: string
          display_order?: number
          duration_days: number
          id: string
          name: string
          price_usdt: number
          wallet_slots?: number
        }
        Update: {
          badge?: string | null
          created_at?: string
          display_order?: number
          duration_days?: number
          id?: string
          name?: string
          price_usdt?: number
          wallet_slots?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_free_gas_count_today: {
        Args: { p_fingerprint?: string; p_ip: string; p_wallets?: string[] }
        Returns: number
      }
      get_public_batch_history: {
        Args: {
          page_limit?: number
          page_offset?: number
          search_name?: string
        }
        Returns: {
          batch_name: string
          created_at: string
          done: number
          duration_seconds: number
          failed: number
          finished_at: string
          id: string
          status: string
          total: number
        }[]
      }
      get_public_name_summary: {
        Args: { search_name?: string }
        Returns: {
          batch_count: number
          batch_name: string
          first_batch_at: string
          last_batch_at: string
          total_failed: number
          total_success: number
          total_wallets: number
        }[]
      }
      get_safe_admin_settings: {
        Args: never
        Returns: {
          gas_loader_enabled: boolean
          id: string
          mobile_recharge_enabled: boolean
          notice_message: string
          updated_at: string
        }[]
      }
      get_user_locked_wallets: {
        Args: { p_membership_id: string; p_wallet: string }
        Returns: {
          added_at: string
          id: string
          wallet_address: string
        }[]
      }
      get_user_memberships: {
        Args: { p_wallet: string }
        Returns: {
          created_at: string
          duration_days: number
          expires_at: string
          id: string
          locked_count: number
          package_id: string
          package_name: string
          price_usdt: number
          starts_at: string
          status: string
          wallet_slots: number
        }[]
      }
      get_user_payments: {
        Args: { p_wallet: string }
        Returns: {
          admin_note: string
          amount_usdt: number
          created_at: string
          expected_amount: number
          id: string
          package_id: string
          status: string
          tx_hash: string
        }[]
      }
      get_vip_job_status: {
        Args: { p_job_id: string; p_wallet: string }
        Returns: {
          batch_name: string
          created_at: string
          delay_ms: number
          done: number
          failed: number
          finished_at: string
          id: string
          status: string
          total: number
        }[]
      }
      get_vip_job_wallets: {
        Args: { p_job_id: string; p_wallet: string }
        Returns: {
          error_message: string
          processed_at: string
          status: string
          tx_hash: string
          wallet_address: string
        }[]
      }
      get_vip_recent_jobs: {
        Args: { p_wallet: string }
        Returns: {
          batch_name: string
          created_at: string
          done: number
          failed: number
          finished_at: string
          id: string
          status: string
          total: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
