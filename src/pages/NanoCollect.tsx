import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { ArrowLeft, Coins, Play, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  getBaseProvider,
  parseKeyList,
  NANOPAY_TOKEN,
  ERC20_ABI,
} from "@/lib/baseChain";

type Row = {
  address: string;
  status: "pending" | "topup" | "sending" | "success" | "skipped" | "failed";
  balance?: string;
  tx?: string;
  error?: string;
};

const GAS_RESERVE = ethers.parseEther("0.00003"); // ~enough for one ERC20 transfer on Base
const TOPUP_AMOUNT = ethers.parseEther("0.00005");

export default function NanoC