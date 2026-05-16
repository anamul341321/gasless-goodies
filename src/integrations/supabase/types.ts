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
          secret_tools_password: string
          updated_at: string
        }
        Insert: {
          gas_loader_enabled?: boolean
          id?: string
          mobile_recharge_enabled?: boolean
          notice_message?: string | null
          secret_tools_password?: string
          updated_at?: string
        }
        Update: {
          gas_loader_enabled?: boolean
          id?: string
          mobile_recharge_enabled?: boolean
          notice_message?: string | null
          secret_tools_password?: string
          updated_at?: string
        }
        Relationships: []
      }
      celo_sweep_jobs: {
        Row: {
          created_at: string
          done: number
          failed_count: number
          finished_at: string | null
          id: string
          last_error: string | null
          last_run_at: string | null
          ok_count: number
          owner_user_id: string
          receiver: string
          status: string
          total: number
          total_swept_celo: string
        }
        Insert: {
          created_at?: string
          done?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          ok_count?: number
          owner_user_id: string
          receiver: string
          status?: string
          total?: number
          total_swept_celo?: string
        }
        Update: {
          created_at?: string
          done?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          ok_count?: number
          owner_user_id?: string
          receiver?: string
          status?: string
          total?: number
          total_swept_celo?: string
        }
        Relationships: []
      }
      celo_sweep_queue: {
        Row: {
          amount: string | null
          attempts: number
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          owner_user_id: string
          private_key: string
          processed_at: string | null
          status: string
          tx_hash: string | null
          wallet_address: string | null
        }
        Insert: {
          amount?: string | null
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          owner_user_id: string
          private_key: string
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          wallet_address?: string | null
        }
        Update: {
          amount?: string | null
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          owner_user_id?: string
          private_key?: string
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "celo_sweep_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "celo_sweep_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_claim_run_items: {
        Row: {
          attempts: number
          created_at: string
          encrypted_key: string | null
          final_status: string
          gas_request_status: string | null
          gas_requested_at: string | null
          gas_tx: string | null
          id: string
          network: string
          owner_user_id: string
          phase1_error: string | null
          phase1_status: string
          phase1_tx: string | null
          phase2_error: string | null
          phase2_status: string | null
          phase2_tx: string | null
          run_id: string
          updated_at: string
          wallet_address: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          encrypted_key?: string | null
          final_status?: string
          gas_request_status?: string | null
          gas_requested_at?: string | null
          gas_tx?: string | null
          id?: string
          network?: string
          owner_user_id: string
          phase1_error?: string | null
          phase1_status?: string
          phase1_tx?: string | null
          phase2_error?: string | null
          phase2_status?: string | null
          phase2_tx?: string | null
          run_id: string
          updated_at?: string
          wallet_address: string
        }
        Update: {
          attempts?: number
          created_at?: string
          encrypted_key?: string | null
          final_status?: string
          gas_request_status?: string | null
          gas_requested_at?: string | null
          gas_tx?: string | null
          id?: string
          network?: string
          owner_user_id?: string
          phase1_error?: string | null
          phase1_status?: string
          phase1_tx?: string | null
          phase2_error?: string | null
          phase2_status?: string | null
          phase2_tx?: string | null
          run_id?: string
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_claim_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "daily_claim_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_claim_runs: {
        Row: {
          failed_gas: number
          failed_other: number
          final_failed: number
          finished_at: string | null
          gas_requests_done_at: string | null
          id: string
          last_error: string | null
          network: string
          owner_user_id: string
          phase: string
          phase1_done_at: string | null
          retry_started_at: string | null
          run_date: string
          started_at: string
          success: number
          total: number
          updated_at: string
        }
        Insert: {
          failed_gas?: number
          failed_other?: number
          final_failed?: number
          finished_at?: string | null
          gas_requests_done_at?: string | null
          id?: string
          last_error?: string | null
          network?: string
          owner_user_id: string
          phase?: string
          phase1_done_at?: string | null
          retry_started_at?: string | null
          run_date: string
          started_at?: string
          success?: number
          total?: number
          updated_at?: string
        }
        Update: {
          failed_gas?: number
          failed_other?: number
          final_failed?: number
          finished_at?: string | null
          gas_requests_done_at?: string | null
          id?: string
          last_error?: string | null
          network?: string
          owner_user_id?: string
          phase?: string
          phase1_done_at?: string | null
          retry_started_at?: string | null
          run_date?: string
          started_at?: string
          success?: number
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      daily_claim_wallets: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          label: string | null
          network: string
          owner_user_id: string
          updated_at: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          label?: string | null
          network?: string
          owner_user_id: string
          updated_at?: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          label?: string | null
          network?: string
          owner_user_id?: string
          updated_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      farmer_jobs: {
        Row: {
          created_at: string
          failed_count: number
          funder_key: string
          g_amount: string
          id: string
          last_error: string | null
          last_run_at: string | null
          ok_count: number
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_count?: number
          funder_key: string
          g_amount?: string
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          ok_count?: number
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_count?: number
          funder_key?: string
          g_amount?: string
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          ok_count?: number
          owner_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      farmer_wallets: {
        Row: {
          created_at: string
          faucet_error: string | null
          faucet_ip: string | null
          faucet_status: string
          faucet_tx_hash: string | null
          gd_error: string | null
          gd_status: string
          gd_tx_hash: string | null
          id: string
          owner_user_id: string
          private_key: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          faucet_error?: string | null
          faucet_ip?: string | null
          faucet_status?: string
          faucet_tx_hash?: string | null
          gd_error?: string | null
          gd_status?: string
          gd_tx_hash?: string | null
          id?: string
          owner_user_id: string
          private_key: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          faucet_error?: string | null
          faucet_ip?: string | null
          faucet_status?: string
          faucet_tx_hash?: string | null
          gd_error?: string | null
          gd_status?: string
          gd_tx_hash?: string | null
          id?: string
          owner_user_id?: string
          private_key?: string
          wallet_address?: string
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
          network: string
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
          network?: string
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
          network?: string
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
      gd_bulk_jobs: {
        Row: {
          amount_per_recipient: string
          approve_tx: string | null
          created_at: string
          failed: number
          finished_at: string | null
          id: string
          last_error: string | null
          sender_address: string
          sender_key_encrypted: string
          sent: number
          skipped: number
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          amount_per_recipient: string
          approve_tx?: string | null
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          sender_address: string
          sender_key_encrypted: string
          sent?: number
          skipped?: number
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          amount_per_recipient?: string
          approve_tx?: string | null
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          sender_address?: string
          sender_key_encrypted?: string
          sent?: number
          skipped?: number
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      gd_bulk_recipients: {
        Row: {
          amount: string
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          processed_at: string | null
          sender_address: string
          status: string
          tx_hash: string | null
          updated_at: string
          wallet_address: string
        }
        Insert: {
          amount: string
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          processed_at?: string | null
          sender_address: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address: string
        }
        Update: {
          amount?: string
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          processed_at?: string | null
          sender_address?: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "gd_bulk_recipients_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "gd_bulk_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      gd_claim_jobs: {
        Row: {
          batch_name: string
          created_at: string
          delay_ms: number
          done: number
          failed: number
          finished_at: string | null
          gas_done_at: string | null
          gas_job_id: string | null
          gas_phase: string
          gas_requested_at: string | null
          id: string
          needs_gas: number
          network: string
          owner_label: string | null
          owner_user_id: string | null
          retried_at: string | null
          retry_eligible_at: string | null
          status: string
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
          gas_done_at?: string | null
          gas_job_id?: string | null
          gas_phase?: string
          gas_requested_at?: string | null
          id?: string
          needs_gas?: number
          network?: string
          owner_label?: string | null
          owner_user_id?: string | null
          retried_at?: string | null
          retry_eligible_at?: string | null
          status?: string
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
          gas_done_at?: string | null
          gas_job_id?: string | null
          gas_phase?: string
          gas_requested_at?: string | null
          id?: string
          needs_gas?: number
          network?: string
          owner_label?: string | null
          owner_user_id?: string | null
          retried_at?: string | null
          retry_eligible_at?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      gd_claim_queue: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          gas_requests: number
          id: string
          job_id: string
          last_gas_request_at: string | null
          private_key: string | null
          processed_at: string | null
          status: string
          tx_hash: string | null
          updated_at: string
          wallet_address: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          gas_requests?: number
          id?: string
          job_id: string
          last_gas_request_at?: string | null
          private_key?: string | null
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          gas_requests?: number
          id?: string
          job_id?: string
          last_gas_request_at?: string | null
          private_key?: string | null
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "gd_claim_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "gd_claim_jobs"
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
      profiles: {
        Row: {
          auth_method: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          wallet_address: string | null
        }
        Insert: {
          auth_method?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
          wallet_address?: string | null
        }
        Update: {
          auth_method?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          wallet_address?: string | null
        }
        Relationships: []
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
      siwe_nonces: {
        Row: {
          created_at: string
          expires_at: string
          nonce: string
          used: boolean
          wallet_address: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          nonce: string
          used?: boolean
          wallet_address: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          nonce?: string
          used?: boolean
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
      delete_my_failed_key: {
        Args: { p_job_id: string; p_wallet_address: string }
        Returns: boolean
      }
      get_free_gas_count_today: {
        Args: { p_fingerprint?: string; p_ip: string; p_wallets?: string[] }
        Returns: number
      }
      get_gd_claim_status: {
        Args: { p_job_id: string }
        Returns: {
          batch_name: string
          created_at: string
          done: number
          failed: number
          finished_at: string
          gas_phase: string
          id: string
          needs_gas: number
          network: string
          status: string
          total: number
        }[]
      }
      get_gd_claim_wallets: {
        Args: { p_job_id: string; p_requester?: string }
        Returns: {
          error_message: string
          gas_requests: number
          private_key: string
          processed_at: string
          status: string
          tx_hash: string
          wallet_address: string
        }[]
      }
      get_my_gd_claim_batches: {
        Args: never
        Returns: {
          batch_name: string
          created_at: string
          done: number
          failed: number
          failed_with_keys: number
          finished_at: string
          gas_phase: string
          id: string
          needs_gas: number
          network: string
          status: string
          total: number
        }[]
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
      get_public_gd_claim_history: {
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
          needs_gas: number
          network: string
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
      get_secret_tools_fingerprint: { Args: never; Returns: string }
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
