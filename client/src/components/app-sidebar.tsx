import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, ClipboardList,
  Trophy, Settings, MapPin, BedDouble, CarFront,
  BarChart2, PhoneForwarded, LogOut, ScrollText, TrendingUp, TrendingDown, MessageCircle, MessagesSquare, ShieldCheck, Sparkles,
  FileText, PlayCircle, Smartphone, BarChart, LifeBuoy, Video, PhoneCall, PhoneOutgoing, BookOpen, Plane, Webhook, Inbox, Clock, ChevronDown, ChevronRight, Settings2, Wallet, CalendarDays, Timer, Fish, ListFilter, Armchair, GraduationCap, UserCheck, Landmark, ListTodo, Zap, MonitorPlay, FileSearch, ArrowRightLeft, BadgeCheck
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { TOURNAMENT_ENABLED, canSeeTournamentHome } from "@shared/tournament";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/lib/auth";
import { APP_VERSION } from "@shared/version";
import { isTvCarParticipant } from "@shared/tv-race-participation";

// PLACEHOLDER_PARTIAL_WILL_REPLACE
