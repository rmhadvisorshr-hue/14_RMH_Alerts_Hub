import { createContext, useContext } from 'react'

// Navigation actions shared by every screen (provided by App):
//   goTab(tab), openEvent(event), openDsc(serial?), openCalendar({ module?, date? }), openNotification(n)
const Ctx = createContext(null)
export const NavProvider = Ctx.Provider
export const useNav = () => useContext(Ctx)
