package com.github.continuedev.continueintellijextension.toolWindow

import com.github.continuedev.continueintellijextension.factories.CustomSchemeHandlerFactory
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.*
import org.cef.CefApp
import org.cef.browser.CefBrowser
import javax.swing.*

class ContinuePluginToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val continueToolWindow = ContinuePluginWindow(toolWindow, project)
        val content = ContentFactory.getInstance().createContent(continueToolWindow.content, null, false)
        toolWindow.contentManager.addContent(content)
        val titleActions = mutableListOf<AnAction>()
        createTitleActions(titleActions)
        toolWindow.setTitleActions(titleActions)
    }

    private fun createTitleActions(titleActions: MutableList<in AnAction>) {
        val action = ActionManager.getInstance().getAction("ContinueSidebarActionsGroup")
        if (action != null) {
            titleActions.add(action)
        }
    }

    override fun shouldBeAvailable(project: Project) = true


    class ContinuePluginWindow(toolWindow: ToolWindow, project: Project) {

        val PASS_THROUGH_TO_CORE = listOf(
                    "abort",
                    "getContinueDir",
                    "history/list",
                    "history/save",
                    "history/delete",
                    "history/load",
                    "devdata/log",
                    "config/addModel",
                    "config/deleteModel",
                    "config/addOpenAIKey",
                    "llm/streamComplete",
                    "llm/streamChat",
                    "llm/complete",
                    "command/run",
                    "context/loadSubmenuItems",
                    "context/getContextItems",
                    "context/addDocs",
                    "config/getBrowserSerialized",
        )


        val webView: JBCefBrowser by lazy {
            val browser = JBCefBrowser.createBuilder().build()
            registerAppSchemeHandler()

            browser.loadURL("http://continue/index.html")
//            browser.loadHTML("<html><body><input type='text'/></body></html>")
//            browser.loadURL("http://localhost:5173/index.html")
            Disposer.register(project, browser)

            browser
        }

        fun executeJavaScript(browser: CefBrowser?, myJSQueryOpenInBrowser: JBCefJSQuery) {
            // Execute JavaScript - you might want to handle potential exceptions here
            val script = """window.postIntellijMessage = function(messageType, data, messageId) {
                const msg = JSON.stringify({messageType, data, messageId});
                ${myJSQueryOpenInBrowser.inject("msg")}
            }""".trimIndent()

            browser?.executeJavaScript(script, browser.url, 0)
        }

        val content: JComponent
            get() = webView.component

        private fun registerAppSchemeHandler() {
            CefApp.getInstance().registerSchemeHandlerFactory(
                    "http",
                    "continue",
                    CustomSchemeHandlerFactory()
            )
        }
    }
}