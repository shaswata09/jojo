import { useState } from 'react'
import { TODAY } from '@/lib/today'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import type { Theme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { IconButton } from '@/components/ui/Button'
import { MenuSheet } from '@/components/ui/Menu'
import { Txt } from '@/components/ui/Text'
import { bucketOf } from '@jojo/service/data/timeline'
import { useCreateActions, useRunCreateAction } from '@/lib/create-actions'
import { useApplications, useScout, useTimeline } from '@/lib/store-context'
import { linking } from '@/navigation/linking'
import type { RootStackParamList, TabParamList } from '@/navigation/types'
import { ApplicationDetailScreen } from '@/screens/ApplicationDetailScreen'
import { OrganisationScreen } from '@/screens/OrganisationScreen'
import { ApplicationsScreen } from '@/screens/ApplicationsScreen'
import { AssistantScreen } from '@/screens/AssistantScreen'
import { CalendarScreen } from '@/screens/CalendarScreen'
import { GraphScreen } from '@/screens/GraphScreen'
import { GuideScreen } from '@/screens/guide/GuideScreen'
import { JobScoutScreen } from '@/screens/JobScoutScreen'
import { MoreScreen } from '@/screens/MoreScreen'
import { hostOf } from '@jojo/service/core/capture'
import { PostingBrowserScreen } from '@/screens/PostingBrowserScreen'
import { ProfileScreen } from '@/screens/ProfileScreen'
import { SearchScreen } from '@/screens/SearchScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { StatisticsScreen } from '@/screens/StatisticsScreen'
import { TodayScreen } from '@/screens/TodayScreen'
import { TransferScreen } from '@/screens/TransferScreen'
import { VaultScreen } from '@/screens/vault/VaultScreen'
import { useTheme } from '@/theme/theme-context'
import { fonts, space } from '@/theme/tokens'

const Tabs = createBottomTabNavigator<TabParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()

/**
 * Five tabs, and the four besides More are what a job search touches daily.
 *
 * The web sidebar carries six workflow destinations plus four utility icons in
 * the top bar. Ten is fine in a 232px rail and impossible in a tab bar, so Job
 * scout and Statistics move under More with the account pages — which is where
 * every design system puts a class of destination you visit occasionally rather
 * than as part of the work.
 */
function TabNavigator() {
  const { colors: c } = useTheme()
  const { all } = useApplications()
  const { reminders, thisWeek } = useTimeline()
  const { matches } = useScout()

  /**
   * Live counts, never frozen strings.
   *
   * Every badge in the web app started as a literal — '3 due' stayed at three
   * however many you cleared, which teaches people to stop believing the number.
   * Each of these counts something visible on the screen it sits beside.
   */
  const flagged = all.filter((a) => a.flagged).length
  const week = thisWeek.length
  const overdue = reminders.filter((r) => !r.completedOn && bucketOf(r, TODAY) === 'overdue').length
  const freshMatches = matches.filter((m) => !m.applicationId).length

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text1,
        tabBarInactiveTintColor: c.text3,
        tabBarStyle: {
          backgroundColor: c.panel,
          borderTopColor: c.hairline,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarBadgeStyle: {
          backgroundColor: c.danger,
          color: c.page,
          fontFamily: fonts.semibold,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="sun" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Applications"
        component={ApplicationsScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="clipboard" size={size} color={color} />,
          tabBarBadge: flagged > 0 ? flagged : undefined,
          tabBarAccessibilityLabel:
            flagged > 0 ? `Applications, ${flagged} flagged for follow-up` : 'Applications',
        }}
      />
      <Tabs.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
          tabBarBadge: week > 0 ? week : undefined,
          tabBarAccessibilityLabel:
            week > 0 ? `Calendar, ${week} in the next seven days` : 'Calendar',
        }}
      />
      <Tabs.Screen
        name="Vault"
        component={VaultScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="archive" size={size} color={color} />,
          tabBarBadge: overdue > 0 ? overdue : undefined,
          tabBarAccessibilityLabel:
            overdue > 0 ? `Vault, ${overdue} reminders past their date` : 'Vault',
        }}
      />
      <Tabs.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="grid" size={size} color={color} />,
          tabBarBadge: freshMatches > 0 ? freshMatches : undefined,
          tabBarAccessibilityLabel:
            freshMatches > 0
              ? `More, ${freshMatches} matches not yet added to applications`
              : 'More',
        }}
      />
    </Tabs.Navigator>
  )
}

/**
 * Create, from anywhere.
 *
 * The same three sheets are reachable from empty states, a board column and a
 * row's overflow — but until this button landed in the chrome, adding a reminder
 * meant first finding the screen that owned reminders.
 */
function CreateButton() {
  const runCreateAction = useRunCreateAction()
  const actions = useCreateActions()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <IconButton icon="plus" label="Create" onPress={() => setMenuOpen(true)} />
      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Create"
        actions={actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: action.icon,
          hint: action.hint,
          onPress: () => runCreateAction(action),
        }))}
      />
    </>
  )
}

/** The two chrome controls the tab screens carry: search, and create. */
function HeaderActions({ onSearch }: { onSearch: () => void }) {
  return (
    <View style={styles.headerActions}>
      <IconButton icon="search" label="Search" onPress={onSearch} />
      <CreateButton />
    </View>
  )
}

export function RootNavigator() {
  const { theme, colors: c } = useTheme()
  // A container ref rather than `useNavigation`: `headerRight` is rendered by
  // the navigator itself, which is outside any screen's navigation context.
  const navigationRef = useNavigationContainerRef<RootStackParamList>()

  const navTheme: Theme = {
    ...(theme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: c.accent,
      background: c.page,
      card: c.panel,
      text: c.text1,
      border: c.hairline,
      notification: c.danger,
    },
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: c.page },
          headerTintColor: c.text1,
          headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.page },
        }}
      >
        <Stack.Screen
          name="Tabs"
          component={TabNavigator}
          options={{
            // The tab screens draw their own titles, so the stack header is
            // here only for the two chrome controls.
            headerTitle: () => (
              <Txt size="md" weight="semibold">
                jojo
              </Txt>
            ),
            headerRight: () => <HeaderActions onSearch={() => navigationRef.navigate('Search')} />,
          }}
        />
        <Stack.Screen
          name="ApplicationDetail"
          component={ApplicationDetailScreen}
          options={{ title: 'Application' }}
        />
        <Stack.Screen
          name="Organisation"
          component={OrganisationScreen}
          options={{ title: 'Employer' }}
        />
        <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
        <Stack.Screen name="JobScout" component={JobScoutScreen} options={{ title: 'Job scout' }} />
        <Stack.Screen
          name="Statistics"
          component={StatisticsScreen}
          options={{ title: 'Statistics' }}
        />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'My profile' }} />
        <Stack.Screen
          name="Assistant"
          component={AssistantScreen}
          options={{ title: 'Assistant' }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Guide" component={GuideScreen} options={{ title: 'How to use' }} />
        <Stack.Screen name="Graph" component={GraphScreen} options={{ title: 'Graph' }} />
        <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
        {/* Titled by the site rather than by the app, because the user is
            looking at somebody else's page and the header is the only thing
            saying whose. `headerBackTitle` is emptied so a long host does not
            get truncated by the word "Back" on iOS. */}
        <Stack.Screen
          name="PostingBrowser"
          component={PostingBrowserScreen}
          options={({ route }) => ({
            title: hostOf(route.params.url),
            headerBackTitle: '',
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
})
