/**
 * RootNavigator.tsx — the app shell.
 *
 * A five-tab bottom bar (Home, Academics, Events, PYQs, More) with nested native
 * stacks for Academics and More. The active tab gets an animated accent pill and
 * a spring on the icon — a real active state, not just a colour swap. The bar
 * respects the Android gesture/inset safe area so nothing sits under the nav bar.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../state/AppContext';
import { HomeScreen } from '../screens/HomeScreen';
import { AcademicsScreen } from '../screens/AcademicsScreen';
import { TimetableScreen } from '../screens/TimetableScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { AttendancePredictorScreen } from '../screens/AttendancePredictorScreen';
import { AssignmentsScreen } from '../screens/AssignmentsScreen';
import { FreeClassroomsScreen } from '../screens/FreeClassroomsScreen';
import { MarksScreen } from '../screens/MarksScreen';
import { GradePredictorScreen } from '../screens/GradePredictorScreen';
import { ExamsScreen } from '../screens/ExamsScreen';
import { OdScreen } from '../screens/OdScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { EventsScreen } from '../screens/EventsScreen';
import { PyqScreen } from '../screens/PyqScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TransportScreen } from '../screens/TransportScreen';
import { RADIUS, SP, TYPE, FONT } from '../theme';

const Tab = createBottomTabNavigator();
const AcademicsStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

function AcademicsNavigator() {
  const { theme } = useApp();
  return (
    <AcademicsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontFamily: FONT.extrabold, fontSize: 18 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <AcademicsStack.Screen name="AcademicsHome" component={AcademicsScreen} options={{ headerShown: false }} />
      <AcademicsStack.Screen name="Timetable" component={TimetableScreen} options={{ title: 'Timetable' }} />
      <AcademicsStack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
      <AcademicsStack.Screen name="AttendancePredictor" component={AttendancePredictorScreen} options={{ title: 'Attendance predictor' }} />
      <AcademicsStack.Screen name="FreeClassrooms" component={FreeClassroomsScreen} options={{ title: 'Free classrooms' }} />
      <AcademicsStack.Screen name="Marks" component={MarksScreen} options={{ title: 'Marks' }} />
      <AcademicsStack.Screen name="GradePredictor" component={GradePredictorScreen} options={{ title: 'Grade predictor' }} />
      <AcademicsStack.Screen name="Exams" component={ExamsScreen} options={{ title: 'Exams' }} />
      <AcademicsStack.Screen name="Assignments" component={AssignmentsScreen} options={{ title: 'Assignments' }} />
      <AcademicsStack.Screen name="Od" component={OdScreen} options={{ title: 'OD Calculator' }} />
      <AcademicsStack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Academic Calendar' }} />
    </AcademicsStack.Navigator>
  );
}

function MoreNavigator() {
  const { theme } = useApp();
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontFamily: FONT.extrabold, fontSize: 18 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <MoreStack.Screen name="MoreHome" component={MoreScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <MoreStack.Screen name="Transport" component={TransportScreen} options={{ title: 'Transport' }} />
    </MoreStack.Navigator>
  );
}

const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['home', 'home-outline'],
  Academics: ['school', 'school-outline'],
  Events: ['ticket', 'ticket-outline'],
  PYQs: ['library', 'library-outline'],
  More: ['apps', 'apps-outline'],
};

function TabIcon({ route, focused, color }: { route: string; focused: boolean; color: string }) {
  const { theme } = useApp();
  const [active, inactive] = ICONS[route] ?? ['ellipse', 'ellipse-outline'];
  const scale = useRef(new Animated.Value(focused ? 1 : 0.9)).current;
  const pill = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: focused ? 1 : 0.9, useNativeDriver: true, speed: 24, bounciness: 8 }),
      Animated.timing(pill, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [focused, scale, pill]);

  const pillScale = pill.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <View style={styles.tabItem}>
      <Animated.View style={[styles.tabPillBg, { backgroundColor: theme.accentSoft, opacity: pill, transform: [{ scaleX: pillScale }] }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={focused ? active : inactive} size={20} color={color} />
      </Animated.View>
    </View>
  );
}

export function RootNavigator() {
  const { theme } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60 + insets.bottom,
          paddingTop: SP.sm,
          paddingBottom: Math.max(insets.bottom, SP.sm),
          elevation: 0,
        },
        tabBarLabelStyle: { ...TYPE.caption, fontSize: 10.5, marginTop: 2 },
        tabBarLabelPosition: 'below-icon',
        tabBarIcon: ({ focused, color }) => <TabIcon route={route.name} focused={focused} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Academics" component={AcademicsNavigator} />
      <Tab.Screen name="Events" component={EventsScreen} />
      <Tab.Screen name="PYQs" component={PyqScreen} />
      <Tab.Screen name="More" component={MoreNavigator} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabItem: { alignItems: 'center', justifyContent: 'center', height: 30, minWidth: 52 },
  tabPillBg: { position: 'absolute', width: 52, height: 30, borderRadius: RADIUS.pill },
});
